import { validateRuntimeDatabaseRole } from "./runtime-db-policy.mjs";
import { paymentDriver, paymentPrefix } from "../src/lib/providers/catalog.mjs";
import { Pool } from 'pg';
import { postgresConfig } from './postgres-config.mjs';
import manifest from '../migrations.sha256.json' with { type: 'json' };
const pool = new Pool(postgresConfig(process.env.DATABASE_URL));
try {
  if (['production','staging'].includes(process.env.ELEMARKET_ENV)) await validateRuntimeDatabaseRole(pool);
  const applied = await pool.query('select name,checksum from _migrations');
  if (Object.entries(manifest).some(([name,hash]) => !applied.rows.some(r=>r.name===name && r.checksum===hash))) throw new Error('Deployment migrations are missing or mismatched');
  const providers = await pool.query("select provider_key,status,driver_key,method,requires_merchant_account,supports_webhook_verification from payment_providers where status='active' or exists(select 1 from payments p where p.provider_key=payment_providers.provider_key and p.status in ('initiated','authorized','completed'))");
  const configured = new Set((process.env.ELEMARKET_PAYMENT_PROVIDERS ?? '').split(',').map(x=>x.trim()).filter(Boolean));
  if (!providers.rows.length) {
    console.log(JSON.stringify({event:'startup.payment_state',payment:'disabled'}));
  }
  for (const p of providers.rows) {
    const prefix = paymentPrefix(p.provider_key);
    const driver = paymentDriver(p.driver_key);
    if (p.status === 'active' && (!driver.capabilities.methods.includes(p.method) || p.requires_merchant_account !== driver.capabilities.merchantAccount || !p.supports_webhook_verification)) throw new Error(`payment provider '${p.provider_key}': database method/capability mismatch`);
    if (!configured.has(p.provider_key) || process.env[`${prefix}_DRIVER`]?.trim() !== p.driver_key || driver.required.some(suffix => !process.env[`${prefix}_${suffix}`]?.trim())) throw new Error(`payment provider '${p.provider_key}': driver/configuration mismatch`);
  }
  if (providers.rows.length) {
    const capabilities = await pool.query('select driver_key,refund,delivery_dispute_hold from payment_driver_capabilities');
    for (const p of providers.rows) {
      if (!capabilities.rows.some(row => row.driver_key === p.driver_key)) throw new Error(`payment provider '${p.provider_key}': missing database capability metadata`);
    }
    for (const row of capabilities.rows) {
      const driver = paymentDriver(row.driver_key);
      if (row.refund !== driver.capabilities.refund || row.delivery_dispute_hold !== driver.capabilities.deliveryDisputeHold) throw new Error('Database payment capability mismatch');
    }
  }
  console.log(JSON.stringify({event:'startup.database_validated'}));
} finally { await pool.end(); }
