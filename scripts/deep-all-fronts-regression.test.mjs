import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');

test('payment return never trusts a browser-persisted provider checkout URL', () => {
  const checkout = read('src/routes/checkout.tsx');
  const ret = read('src/routes/payment.return.tsx');
  assert.match(checkout, /const queue: Array<\{ paymentId: string \}>/);
  assert.doesNotMatch(checkout, /queue\.push\(\{ paymentId, checkoutUrl/);
  assert.match(ret, /createPaymentIntent/);
  assert.doesNotMatch(ret, /remaining\[0\]\.checkoutUrl/);
});

test('public catalog server functions have durable abuse limits and bounded result sets', () => {
  const s = read('src/lib/market/catalog.ts');
  for (const scope of ['catalog-list-products','catalog-get-product','catalog-list-merchants','catalog-get-merchant','catalog-resolve-merchants']) {
    assert.match(s, new RegExp(`enforceRateLimit\\("${scope}"`));
  }
  assert.match(s, /order by name limit 500/);
  assert.match(s, /order by p\.name limit 100/);
});

test('external provider requests reject redirects so credentials cannot be forwarded to a new host', () => {
  for (const file of [
    'src/lib/market/adapters/providers/paystack.ts',
    'src/lib/market/adapters/payment.ts',
    'src/lib/market/adapters/delivery.server.ts',
    'src/lib/market/adapters/location.server.ts',
    'src/lib/market/search.server.ts',
    'src/lib/auth/email/providers/resend.server.ts',
    'src/lib/auth/otp/providers/arkesel.server.ts',
    'src/lib/kyb/providers/fylings.server.ts',
    'src/lib/notifications/push/providers/fcm.server.ts',
  ]) assert.match(read(file), /redirect:\s*["']error["']/);
});

test('administrator 2FA is an assurance boundary, not merely an account flag', () => {
  const authz = read('src/lib/auth/authorization.server.ts');
  const auth = read('src/lib/auth/server.ts');
  const migration = read('migrations/0073_admin_2fa_session_assurance.sql');
  assert.match(auth, /accountLockout:\s*\{\s*enabled:\s*true/);
  assert.match(authz, /twoFactorEnabledAt/);
  assert.match(authz, /auth\.api\.getSession/);
  assert.match(authz, /session\.session\.createdAt/);
  assert.match(migration, /user_two_factor_assurance_stamp/);
});

test('mobile API transport refuses non-443 HTTPS ports', () => {
  const s = read('mobile/src/auth.ts');
  assert.match(s, /url\.port !== "443"/);
  assert.doesNotMatch(s, /\["443", "80"\]/);
});

test('SSRF guard covers transition IPv6 families', () => {
  const s = read('src/lib/security/ssrf.server.ts');
  for (const marker of ['Teredo', '6to4', 'IPv4-compatible', 'IPv4-mapped']) assert.match(s, new RegExp(marker.replace('-', '\\-')));
});
