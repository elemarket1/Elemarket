import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');

test('mobile state-changing API routes enforce same-site isolation', () => {
  for (const file of [
    'src/routes/api.mobile.checkout.ts',
    'src/routes/api.mobile.payment-intent.ts',
    'src/routes/api.mobile.payment-status.ts',
    'src/routes/api.mobile.profile.ts',
  ]) {
    const s = read(file);
    assert.match(s, /assertSameSiteRequest/ , `${file} must enforce same-site isolation`);
  }
});

test('merchant financing API is rate-limited and idempotent', () => {
  const s = read('src/lib/market/financing.ts');
  assert.match(s, /merchant-financing-start/);
  assert.match(s, /idempotencyKey: z\.string\(\)\.min\(16\)\.max\(128\)/);
  assert.match(s, /merchant_financing_applications[\s\S]{0,500}idempotency_key/);
});

test('merchant financing migration enforces retry uniqueness', () => {
  const s = read('migrations/0094_merchant_financing_idempotency.sql');
  assert.match(s, /add column if not exists idempotency_key/);
  assert.match(s, /merchant_financing_idempotency_uq/);
  assert.match(s, /merchant_id,idempotency_key/);
});

test('merchant application and customer profile writes have abuse limits', () => {
  const s = read('src/lib/auth/account.functions.ts');
  assert.match(s, /merchant-application-submit/);
  assert.match(s, /customer-profile-write/);
});
