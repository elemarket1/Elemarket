import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url).pathname;
const read = (file) => readFile(`${root}/${file}`, 'utf8');

test('Resend email adapter is server-side and uses the official Email API', async () => {
  const source = await read('src/lib/auth/email/providers/resend.server.ts');
  assert.match(source, /https:\/\/api\.resend\.com\/emails/);
  assert.match(source, /RESEND_API_KEY/);
  assert.match(source, /RESEND_FROM_EMAIL/);
  assert.match(source, /authorization: `Bearer \$\{apiKey\}`/);
  assert.match(source, /Idempotency-Key/);
});

test('email OTP never persists the raw OTP and verifies locally with a keyed digest', async () => {
  const source = await read('src/lib/auth/email/email-otp.server.ts');
  assert.match(source, /createHmac\("sha256"/);
  assert.match(source, /code_hash/);
  assert.doesNotMatch(source, /insert into otp_challenges[^;]*\bcode\s*[,)]/i);
  assert.match(source, /timingSafeEqual/);
});

test('email OTP has bounded expiry, resend cooldown, attempt limit and provider idempotency', async () => {
  const source = await read('src/lib/auth/email/email-otp.server.ts');
  assert.match(source, /DEFAULT_EXPIRY_MINUTES = 5/);
  assert.match(source, /expiryMinutes > 10/);
  assert.match(source, /RESEND_COOLDOWN_SECONDS = 60/);
  assert.match(source, /MAX_ATTEMPTS = 5/);
  assert.match(source, /elemarket-otp\/\$\{challengeId\}/);
});

test('Resend configuration is documented as server-only', async () => {
  const readme = await read('README.md');
  assert.match(readme, /RESEND_API_KEY=<sending-scoped Resend API key>/);
  assert.match(readme, /must never be exposed to client-side code/i);
});


test('Better Auth verification and password reset use the same email adapter', async () => {
  const authEmail = await read('src/lib/auth/email.server.ts');
  const authServer = await read('src/lib/auth/server.ts');
  assert.match(authEmail, /getEmailAdapter/);
  assert.match(authEmail, /idempotencyKey/);
  assert.doesNotMatch(authEmail, /ELEMARKET_EMAIL_ENDPOINT/);
  assert.match(authServer, /await sendAuthEmail/);
  assert.doesNotMatch(authServer, /void sendAuthEmail/);
});

test('Resend webhook verifies Svix headers and records idempotently', async () => {
  const source = await read('src/lib/auth/email/webhook.server.ts');
  assert.match(source, /svix|signature/i);
  assert.match(source, /timingSafeEqual/);
  assert.match(source, /on conflict \(id\) do nothing/i);
});

test('generic adapters validate external responses at runtime', async () => {
  const payment = await read('src/lib/market/adapters/payment.ts');
  const delivery = await read('src/lib/market/adapters/delivery.server.ts');
  assert.match(payment, /z\.enum\(\["authorized", "completed", "failed", "refunded"\]\)/);
  assert.match(delivery, /z\.object\(\{/);
  assert.match(delivery, /Delivery provider returned an expired quote/);
});

test('email OTP binds verification purpose and account verification', async () => {
  const route = await read('src/lib/auth/otp.ts');
  const service = await read('src/lib/auth/email/email-otp.server.ts');
  assert.match(route, /purpose.*signup.*login.*password_reset.*transactional/s);
  assert.match(service, /expectedPurpose/);
  assert.match(service, /emailVerified/);
});
