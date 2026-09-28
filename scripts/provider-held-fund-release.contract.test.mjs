import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync('migrations/0070_paystack_refund_non_custodial_migration.sql', 'utf8');
const merchantDashboard = fs.readFileSync('src/routes/merchant/dashboard.tsx', 'utf8');
const adminDashboard = fs.readFileSync('src/routes/admin/dashboard.tsx', 'utf8');

 test('legacy fund-release workflow is disabled in favor of provider refunds', () => {
  assert.match(migration, /create table if not exists provider_refund_requests/);
  assert.match(migration, /merchant fund release is disabled/);
  assert.match(migration, /ELEMARKET does not custody/);
});

test('provider refund requests are bound to the payment provider reference', () => {
  assert.match(migration, /provider_refund_requests/);
  assert.match(migration, /provider_reference/);
  assert.match(migration, /provider_refund_requests_payment_active_uq/);
});

test('admin disputes prepare provider refunds instead of local release approval', () => {
  assert.match(migration, /prepare_provider_refund_for_dispute/);
  assert.match(migration, /status='refund_pending'/);
  assert.doesNotMatch(adminDashboard, /Approve for provider/);
});

test('merchant dashboard describes provider-managed settlement', () => {
  assert.match(merchantDashboard, /Payment & settlement/);
  assert.match(merchantDashboard, /Provider-managed/);
  assert.doesNotMatch(merchantDashboard, /Request funds for verification/);
});
