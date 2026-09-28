import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const registry = fs.readFileSync('src/lib/market/adapters/registry.ts', 'utf8');
const payment = fs.readFileSync('src/lib/market/payment.ts', 'utf8');

test('driver registry has no vendor-specific imports or vendor selection branches', () => {
  assert.doesNotMatch(registry, /providers\/paystack|Paystack|Hubtel|Motito/i);
  assert.doesNotMatch(registry, /driver\s*===\s*["']paystack/i);
  assert.match(registry, /ELEMARKET_PAYMENT_DRIVER_.*_MODULE/);
});

test('provider-specific currency and verification rules remain inside the adapter', () => {
  assert.doesNotMatch(payment, /currency\s*===\s*["']GHS["']/i);
  assert.doesNotMatch(payment, /amount\s*\/\s*100/);
});

test('paystack adapter exposes only the deployment driver factory to the neutral registry', () => {
  const adapter = fs.readFileSync('src/lib/market/adapters/providers/paystack.ts', 'utf8');
  assert.match(adapter, /export function createPaymentAdapter/);
  assert.match(adapter, /ELEMARKET_PAYMENT_.*_SECRET/);
});
