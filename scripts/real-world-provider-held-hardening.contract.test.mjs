import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync('migrations/0061_real_world_provider_hold_hardening.sql','utf8');
const webhook = fs.readFileSync('src/routes/api.payments.webhook.ts','utf8');
const finance = fs.readFileSync('src/lib/market/merchant-finance.server.ts','utf8');

 test('legacy local settlement path is disabled', () => {
  assert.match(migration, /local settlement execution is disabled/i);
  assert.match(migration, /Never creates local payout\/settlement records/i);
  assert.doesNotMatch(migration, /insert into merchant_settlements\(/i);
});

test('provider payment completion does not create local escrow', () => {
  const refundMigration = fs.readFileSync('migrations/0070_paystack_refund_non_custodial_migration.sql','utf8');
  assert.match(refundMigration, /drop trigger if exists payment_completed_escrow_create/);
  assert.match(refundMigration, /provider_refund_requests/);
});

test('approval re-runs risk and correctly excludes the current request from reservation capacity', () => {
  assert.match(migration, /evaluate_merchant_withdrawal_risk\(v_merchant,v_r\.amount\)/);
  assert.match(migration, /r\.id<>v_r\.id/);
  assert.match(migration, /admin review note is required for a review-risk request/);
});

test('provider refunds are idempotent by payment and provider reference', () => {
  const refundMigration = fs.readFileSync('migrations/0070_paystack_refund_non_custodial_migration.sql','utf8');
  assert.match(refundMigration, /provider_refund_requests_payment_active_uq/);
  assert.match(refundMigration, /provider_refund_requests_provider_ref_uq/);
  assert.match(refundMigration, /existing/);
});

test('real provider webhook accepts signature headers while provider routing is resolved cryptographically', () => {
  assert.match(fs.readFileSync("src/lib/market/adapters/providers/paystack.ts", "utf8"), /x-paystack-signature/);
  assert.match(webhook, /providerHint/);
  assert.match(webhook, /handlePaymentWebhook/);
  const payment = fs.readFileSync('src/lib/market/payment.server.ts','utf8');
  assert.match(payment, /verifiedProviders\.length !== 1/);
  assert.match(payment, /adapter\.verifyWebhook/);
});

test('merchant refund exceptions are derived from provider refund state', () => {
  assert.match(finance, /provider_refund_requests/);
  assert.match(finance, /needs_attention/);
  assert.match(finance, /failed/);
});
