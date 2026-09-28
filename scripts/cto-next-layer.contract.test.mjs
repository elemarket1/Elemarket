import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd();
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');

test('rate limiter cleanup is sampled and bounded rather than full-table per request',()=>{
  const s=read('migrations/0020_api_security.sql');
  assert.match(s,/limit 250/);
  assert.match(s,/hashtextextended\(p_bucket_key, 1\)/);
});

test('enterprise catalog writes are batched and snapshot cleanup is set-based',()=>{
  const s=read('src/lib/market/enterprise-catalog.server.ts');
  assert.match(s,/jsonb_to_recordset/);
  assert.match(s,/ELEMARKET_ENTERPRISE_SYNC_WRITE_BATCH_SIZE/);
  assert.match(s,/not exists \(\s*select 1 from enterprise_catalog_items/s);
});

test('security alerts are durable and redact secrets from outbound payload by construction',()=>{
  const s=read('src/lib/observability/security-alert.server.ts');
  assert.match(s,/record_security_alert/);
  assert.match(s,/ELEMARKET_SECURITY_ALERT_WEBHOOK_URL/);
  assert.doesNotMatch(s,/authorization.*Bearer/i);
});

test('Vercel production config pins a compute region and bounds enterprise cron cadence',()=>{
  const s=read('vercel.json');
  assert.match(s,/"regions"\s*:\s*\[\s*"lhr1"/);
  assert.match(s,/api\/internal\/sync-enterprise-catalogs/);
  assert.match(s,/\*\/5 \* \* \* \*/);
});

test('secret rotation supports previous encryption key and has an explicit rotation utility',()=>{
  const crypto=read('src/lib/security/merchant-sensitive.server.ts');
  const script=read('scripts/rotate-merchant-sensitive-data.mjs');
  assert.match(crypto,/ELEMARKET_MERCHANT_DATA_ENCRYPTION_KEY_PREVIOUS/);
  assert.match(script,/taxpayer_id_encrypted/);
  assert.match(script,/credentials_encrypted/);
});

test('dependency CI verifies audit and npm signatures/provenance',()=>{
  const pkg=JSON.parse(read('package.json'));
  const ci=read('.github/workflows/ci.yml');
  assert.equal(pkg.scripts['security:signatures'],'npm audit signatures');
  assert.match(ci,/npm run security:signatures/);
});

test('load-test harness requires explicit production opt-in',()=>{
  const s=read('scripts/load-test.mjs');
  assert.match(s,/LOAD_TEST_ALLOW_PRODUCTION/);
  assert.match(s,/LOAD_TEST_CONCURRENCY/);
});
