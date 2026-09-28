import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard = fs.readFileSync('src/routes/merchant/dashboard.tsx','utf8');
const functions = fs.readFileSync('src/routes/merchant/dashboard.functions.ts','utf8');
const enterprise = fs.readFileSync('src/lib/market/enterprise-catalog.server.ts','utf8');
const migration = fs.readFileSync('migrations/0091_merchant_enterprise_dashboard_hardening.sql','utf8');

test('merchant dashboard exposes provider withdrawal timing per order', () => {
  assert.match(dashboard, /withdrawal_eligible/);
  assert.match(dashboard, /eligible_at/);
  assert.match(dashboard, /withdrawal_reason/);
  assert.match(dashboard, /dispute_filed_at/);
});

test('merchant dashboard uses merchant-scoped KYB application lookup', () => {
  assert.match(functions, /where ma\.merchant_id=\$1/);
  assert.doesNotMatch(functions, /where ma\.user_id=\$1 order by ma\.created_at desc limit 1/);
});

test('enterprise dashboard exposes durable sync, webhook and order queues', () => {
  assert.match(functions, /enterprise_catalog_sync_runs/);
  assert.match(functions, /enterprise_webhook_events/);
  assert.match(functions, /enterprise_order_outbox/);
  assert.match(dashboard, /Recent sync runs/);
  assert.match(dashboard, /Webhook queue/);
  assert.match(dashboard, /Order delivery queue/);
});

test('enterprise dashboard can configure webhooks and field mappings', () => {
  assert.match(dashboard, /Enable catalog webhooks/);
  assert.match(dashboard, /Field mapping JSON/);
  assert.match(dashboard, /webhookEnabled/);
  assert.match(dashboard, /webhookSecret/);
});

test('enterprise configuration cannot silently reuse credentials across auth-type changes', () => {
  assert.match(enterprise, /changing enterprise authentication type/);
  assert.match(enterprise, /existing\.auth_type !== input\.authType/);
});

test('enterprise configuration preserves existing endpoints and clears disabled secrets safely', () => {
  assert.match(enterprise, /const orderEndpointUrl = input\.orderEndpointUrl \?\? existing\?\.order_endpoint_url/);
  assert.match(enterprise, /input\.webhookEnabled\n {4}\?/);
  assert.match(enterprise, /input\.authType === "none"/);
});

test('merchant application is bound to its exact merchant workspace', () => {
  assert.match(migration, /add column if not exists merchant_id text references merchants/);
  assert.match(migration, /update merchant_applications set merchant_id=v_merchant_id/);
  assert.match(migration, /having count\(distinct macc\.merchant_id\) = 1/);
});
