import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');

test('checkout idempotency replay returns paymentId', () => {
  const s = read('migrations/0029_live_checkout_provider_binding.sql');
  assert.match(s, /'paymentId', p\.id/);
});

test('Paystack adapter sends provider idempotency key', () => {
  const s = read('src/lib/market/adapters/payment.ts');
  assert.match(s, /idempotency-key/);
});

test('payment core does not require a Paystack secret before adapter resolution', () => {
  const s = read('src/lib/market/payment.ts');
  const block = s.slice(s.indexOf('export async function createExternalPaymentIntent'), s.indexOf('export const createPaymentIntent'));
  assert.doesNotMatch(block, /ELEMARKET_PAYMENT_PAYSTACK_SECRET/);
});

test('concurrent open payment attempts are constrained at database level', () => {
  const s = read('migrations/0032_prelive_financial_integrity.sql');
  assert.match(s, /payment_attempts_payment_attempt_no_uq/);
  assert.doesNotMatch(s, /on payment_attempts_one_open_per_payment_uq/);
});

test('provider-neutral adapter remains available', () => {
  const s = read('src/lib/market/adapters/payment.ts');
  const registry = read('src/lib/market/adapters/registry.ts');
  assert.match(s, /class JsonHttpPaymentAdapter/);
  assert.match(registry, /function getPaymentAdapter/);
});
