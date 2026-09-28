import { Pool } from 'pg';
import { postgresConfig } from './postgres-config.mjs';
import manifest from '../migrations.sha256.json' with { type: 'json' };
const pool = new Pool(postgresConfig(process.env.DATABASE_URL));
try {
  const applied = await pool.query('select name,checksum from _migrations');
  if (Object.entries(manifest).some(([name,hash]) => !applied.rows.some(r=>r.name===name && r.checksum===hash))) throw new Error('Deployment migrations are missing or mismatched');
  const providers = await pool.query("select provider_key,driver_key from payment_providers where status='active'");
  const configured = new Set((process.env.ELEMARKET_PAYMENT_PROVIDERS ?? '').split(',').map(x=>x.trim()));
  if (!providers.rows.length) throw new Error('No active payment providers');
  for (const p of providers.rows) {
    const prefix = `ELEMARKET_PAYMENT_${p.provider_key.toUpperCase().replace(/[^A-Z0-9]+/g,'_')}`;
    if (!configured.has(p.provider_key) || process.env[`${prefix}_DRIVER`] !== p.driver_key || !process.env[`${prefix}_SECRET`]) throw new Error('Active payment provider configuration mismatch');
  }
  console.log(JSON.stringify({event:'startup.database_validated'}));
} finally { await pool.end(); }
