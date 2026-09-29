#!/usr/bin/env node
/** Explicit release operation, never called implicitly by the web runtime. */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { postgresConfig } from './postgres-config.mjs';
import { paymentDriver, paymentPrefix } from '../src/lib/providers/catalog.mjs';
import manifest from '../migrations.sha256.json' with { type: 'json' };

export function validatePaymentActivation(value, environment = process.env) {
  if (!Array.isArray(value) || !value.length || value.length > 32) throw new Error('Payment configuration must contain 1-32 providers');
  if (!['development','staging','production'].includes(environment.ELEMARKET_ENV)) throw new Error('Explicit ELEMARKET_ENV is required');
  const configured = (environment.ELEMARKET_PAYMENT_PROVIDERS || '').split(',').map(x => x.trim()).filter(Boolean);
  const prefixes = configured.map(paymentPrefix);
  if (new Set(prefixes).size !== prefixes.length) throw new Error('Payment aliases collide');
  const seen = new Set();
  return value.map(item => {
    if (!item || typeof item !== 'object' || Object.keys(item).some(k => !['providerKey','name','method'].includes(k))) throw new Error('Invalid payment configuration fields');
    const { providerKey, name, method } = item;
    const prefix = paymentPrefix(providerKey);
    if (!configured.includes(providerKey) || seen.has(providerKey)) throw new Error('Payment alias missing from configured registry or duplicated');
    seen.add(providerKey);
    if (typeof name !== 'string' || name.trim().length < 2 || name.length > 160) throw new Error('Invalid payment display name');
    const driverKey = environment[`${prefix}_DRIVER`]?.trim();
    const driver = paymentDriver(driverKey);
    if (!driver.capabilities.methods.includes(method)) throw new Error(`payment provider '${providerKey}': unsupported method`);
    const missing = driver.required.filter(suffix => !environment[`${prefix}_${suffix}`]?.trim());
    if (missing.length) throw new Error(`payment provider '${providerKey}': missing configuration ${missing.map(s => `${prefix}_${s}`).join(', ')}`);
    return { providerKey, name: name.trim(), method, driverKey, capabilities: driver.capabilities };
  });
}

export async function configurePaymentProviders(pool, entries) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock($1)', [738214901]); // serialize with migrations
    const applied = await client.query('select name,checksum from _migrations');
    if (Object.entries(manifest).some(([name, hash]) => !applied.rows.some(r => r.name === name && r.checksum === hash))) throw new Error('Deployment migrations are missing or mismatched');
    for (const entry of [...entries].sort((a,b) => a.providerKey.localeCompare(b.providerKey))) {
      const c = await client.query('select refund,delivery_dispute_hold from payment_driver_capabilities where driver_key=$1 for share', [entry.driverKey]);
      // delivery_dispute_hold is retained as legacy capability metadata only; it is not a startup or activation gate.
      if (!c.rows[0] || c.rows[0].refund !== entry.capabilities.refund || c.rows[0].delivery_dispute_hold !== entry.capabilities.deliveryDisputeHold) throw new Error('Database payment capability mismatch');
      // The immutable driver trigger rejects reassigning historical payments. Never deactivate other aliases.
      await client.query(`insert into payment_providers(id,provider_key,name,method,status,driver_key,requires_merchant_account,supports_webhook_verification)
        values($1,$2,$3,$4,'active',$5,$6,$7)
        on conflict(provider_key) do update set name=excluded.name,method=excluded.method,status='active',driver_key=excluded.driver_key,
          requires_merchant_account=excluded.requires_merchant_account,supports_webhook_verification=excluded.supports_webhook_verification,updated_at=now()`,
        [`provider_${randomUUID()}`,entry.providerKey,entry.name,entry.method,entry.driverKey,entry.capabilities.merchantAccount,entry.capabilities.webhook]);
    }
    await client.query('commit');
  } catch (error) { await client.query('rollback'); throw error; }
  finally { client.release(); }
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  let pool;
  try {
    const file = process.argv[2];
    if (!file) throw new Error('Usage: npm run providers:configure -- <approved-provider-config.json>');
    const entries = validatePaymentActivation(JSON.parse(await readFile(file, 'utf8')));
    pool = new Pool(postgresConfig(process.env.DATABASE_URL));
    await configurePaymentProviders(pool, entries);
    console.log(JSON.stringify({ event: 'payment.providers_configured', providers: entries.map(x => x.providerKey) }));
  } catch (error) { console.error('[providers]', error.message); process.exitCode = 1; }
  finally { await pool?.end(); }
}
