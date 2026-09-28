import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (file) => fs.readFileSync(file, 'utf8');

test('mobile profile uses a streaming body limit and strict field validation', () => {
  const s = read('src/routes/api.mobile.profile.ts');
  assert.match(s, /readBodyWithLimit\(request, MAX_PROFILE_BODY_BYTES\)/);
  assert.doesNotMatch(s, /request\.json\(\)/);
  assert.match(s, /address: z\.string\(\)\.trim\(\)\.min\(8\)\.max\(400\)/);
  assert.match(s, /phone: ghanaPhoneSchema/);
  assert.match(s, /from "@\/lib\/auth\/phone"/);
  assert.match(s, /code === "23505"/);
});

test('mobile profile body limit is bounded below content-length and chunked-body attacks', () => {
  const s = read('src/lib/security/body.server.ts');
  assert.match(s, /request\.body/);
  assert.match(s, /total \+= value\.byteLength/);
  assert.match(s, /total > maxBytes/);
});

test('search limit is clamped to a positive finite integer', () => {
  const s = read('src/routes/api.search.ts');
  assert.match(s, /Number\.isFinite\(requestedLimit\)/);
  assert.match(s, /Math\.max\(Math\.trunc\(requestedLimit\), 1\)/);
  assert.match(s, /Math\.min\([^\n]*60/);
});

test('payment webhook provider is resolved from a verified signature, not trusted from request routing', () => {
  const route = read('src/routes/api.payments.webhook.ts');
  const payment = read('src/lib/market/payment.server.ts');
  assert.match(route, /providerHint/);
  assert.doesNotMatch(route, /Missing provider/);
  assert.match(payment, /where status='active'/);
  assert.match(payment, /verifiedProviders\.length !== 1/);
  assert.match(payment, /adapter\.verifyWebhook/);
  assert.match(payment, /Ambiguous webhook signature/);
  assert.match(payment, /payment-webhook:\$\{normalizedProviderKey\}/);
});

test('payment webhook remains globally rate limited before provider discovery', () => {
  const route = read('src/routes/api.payments.webhook.ts');
  assert.match(route, /payment-webhook-global/);
  assert.match(route, /maxRequests: 600/);
});
