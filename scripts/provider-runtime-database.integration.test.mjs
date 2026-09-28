import test from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { spawnSync } from 'node:child_process';
const enabled = process.env.RUN_DB_INTEGRATION === '1' && !!process.env.ELEMARKET_INTEGRATION_DATABASE_URL;

test('runtime startup verifies alias credentials, complete migrations and exact installed DB capabilities', { skip: enabled ? false : 'Disposable PostgreSQL required' }, async () => {
  const base = new URL(process.env.ELEMARKET_INTEGRATION_DATABASE_URL);
  const admin = new Pool({ connectionString: base.toString() });
  const name = `provider_startup_${crypto.randomUUID().replaceAll('-','')}`;
  let db;
  try {
    await admin.query(`create database ${name}`);
    base.pathname = `/${name}`;
    const environment = { ...process.env, DATABASE_URL: base.toString(), ELEMARKET_ENV:'development', ELEMARKET_PAYMENT_PROVIDERS:'processor', ELEMARKET_PAYMENT_PROCESSOR_DRIVER:'paystack', ELEMARKET_PAYMENT_PROCESSOR_SECRET:'synthetic' };
    const run = file => spawnSync(process.execPath, [file], {env:environment,encoding:'utf8'});
    const migrated = run('scripts/migrate.mjs');
    assert.equal(migrated.status,0,migrated.stderr);
    db = new Pool({ connectionString: base.toString() });
    await db.query("insert into payment_providers(id,provider_key,name,method,status,driver_key) values('startup-provider','processor','Synthetic processor','mobile_money','active','paystack')");
    assert.equal(run('scripts/validate-runtime-db.mjs').status,0);
    await db.query("update payment_driver_capabilities set refund=false where driver_key='paystack'");
    assert.match(run('scripts/validate-runtime-db.mjs').stderr,/capability mismatch/);
    await db.query('delete from payment_driver_capabilities');
    assert.match(run('scripts/validate-runtime-db.mjs').stderr,/missing database capability metadata/);
    await db.query("insert into payment_driver_capabilities(driver_key,refund,delivery_dispute_hold) values('paystack',true,false)");
    delete environment.ELEMARKET_PAYMENT_PROCESSOR_SECRET;
    assert.match(run('scripts/validate-runtime-db.mjs').stderr,/processor.*configuration mismatch/);
    environment.ELEMARKET_PAYMENT_PROCESSOR_SECRET='synthetic';
    await db.query("delete from _migrations where name='0139_withdrawal_delivered_status.sql'");
    assert.match(run('scripts/validate-runtime-db.mjs').stderr,/migrations are missing/);
  } finally {
    await db?.end();
    await admin.query(`drop database if exists ${name}`);
    await admin.end();
  }
});
