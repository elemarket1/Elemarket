import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), 'utf8');

test('cron uses only canonical CRON_SECRET and bounded retryable upload cleanup', () => {
  const s = read('src/routes/api.internal.expire-payment-orders.ts');
  assert.match(s, /process\.env\.CRON_SECRET/);
  assert.doesNotMatch(s, /ELEMARKET_CRON_SECRET/);
  assert.match(s, /status='cleanup_pending'/);
  assert.match(s, /limit 100/);
  assert.match(s, /for update skip locked/i);
  assert.match(s, /set status='expired'/);
});

test('storage migration makes failed remote deletion retryable', () => {
  const s = read('migrations/0083_storage_cleanup_retry_state.sql');
  assert.match(s, /cleanup_pending/);
  assert.match(s, /storage_upload_intents_cleanup_idx/);
});

test('payment adapters explicitly declare duplicate-safe initialization capability', () => {
  const s = read('src/lib/market/adapters/payment.ts');
  assert.match(s, /supportsIdempotentInitialization/);
  assert.match(s, /JsonHttpPaymentAdapter[\s\S]*supportsIdempotentInitialization = false/);
  assert.match(s, /PreviewPaymentAdapter[\s\S]*supportsIdempotentInitialization = true/);
  const paystack = read('src/lib/market/adapters/providers/paystack.ts');
  assert.match(paystack, /supportsIdempotentInitialization = true/);
});

test('payment initialization fails closed for providers without duplicate-safe initialization', () => {
  const s = read('src/lib/market/payment.server.ts');
  assert.match(s, /supportsIdempotentInitialization/);
  assert.match(s, /does not support duplicate-safe initialization/);
  assert.match(s, /returning id/);
  assert.match(s, /Payment initiation lease lost before provider binding/);
});


test('storage cleanup uses a durable per-intent claim token for overlapping cron safety', () => {
  const s = read('src/routes/api.internal.expire-payment-orders.ts');
  assert.match(s, /cleanupClaimToken/);
  assert.match(s, /cleanup_claim_token/);
  assert.match(s, /cleanup_claim_expires_at/);
  assert.match(s, /status='expired'.*cleanup_claim_token=null/s);
});

test('rate limiter does not trust arbitrary Cloudflare or x-real-ip headers', () => {
  const s = read('src/lib/security/rate-limit.server.ts');
  assert.doesNotMatch(s, /cf-connecting-ip/);
  assert.doesNotMatch(s, /headers\.get("x-real-ip")/);
  assert.match(s, /x-vercel-forwarded-for/);
});

test('enterprise catalog lease renews by elapsed time', () => {
  const s = read('src/lib/market/enterprise-catalog.server.ts');
  assert.match(s, /lastLeaseRenewalAt/);
  assert.match(s, />= 60_000/);
});
