import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

test('shared deployments cannot use the dev-user fallback', () => {
  const verify = read('src/lib/auth/verify.server.ts');
  const client = read('src/lib/auth/use-current-user.ts');
  assert.match(verify, /ELEMARKET_ENV === "development"/);
  assert.match(verify, /!localDevelopmentFallbackAllowed/);
  assert.match(client, /VITE_AUTH_ENABLED === "false" && !import\.meta\.env\.PROD/);
});

test('enterprise catalog sync uses a durable expiring lease instead of autocommit FOR UPDATE', () => {
  const connector = read('src/lib/market/enterprise-catalog.server.ts');
  const migration = read('migrations/0081_enterprise_catalog_sync_lease.sql');
  assert.doesNotMatch(connector, /where merchant_id=\$1 for update/);
  assert.match(connector, /sync_lock_token/);
  assert.match(connector, /sync_lock_expires_at/);
  assert.match(connector, /sync lease lost/);
  assert.match(migration, /add column if not exists sync_lock_token/);
  assert.match(migration, /add column if not exists sync_lock_expires_at/);
});

test('payment webhook retry classification is structured, not message-regex based', () => {
  const route = read('src/routes/api.payments.webhook.ts');
  const payment = read('src/lib/market/payment.server.ts');
  assert.doesNotMatch(route, /const retryable/);
  assert.match(route, /SQLSTATE/);
  assert.match(payment, /Payment reference is not bound yet/);
  assert.match(payment, /status: 503, retryable: true/);
});

test('provider transaction verification maps HTTP failures to explicit provider errors', () => {
  const generic = read('src/lib/market/adapters/payment.ts');
  const paystack = read('src/lib/market/adapters/providers/paystack.ts');
  assert.doesNotMatch(generic, /class JsonHttpPaymentAdapter/);
  assert.match(paystack, /PaymentProviderError/);
  assert.match(paystack, /response\.status/);
});
