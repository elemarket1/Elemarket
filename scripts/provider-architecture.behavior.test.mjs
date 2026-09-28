import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { components, selectedProvider, paymentDriver, validateProviderConfiguration } from '../src/lib/providers/catalog.mjs';
import { browserPolicy } from '../src/lib/providers/browser-policy.mjs';
import { loadTypeScript } from './helpers/load-typescript.mjs';

const staging = {
  ELEMARKET_DELIVERY_PROVIDER: 'courier', ELEMARKET_DELIVERY_COURIER_ENDPOINT: 'https://courier.example.com/quote', ELEMARKET_DELIVERY_COURIER_SECRET: 'synthetic',
  ELEMARKET_ENV: 'staging', ELEMARKET_STORAGE_PROVIDER: 's3', STORAGE_ENDPOINT: 'https://objects.example.com', STORAGE_REGION: 'eu-west-1', STORAGE_BUCKET: 'private-objects', STORAGE_ACCESS_KEY_ID: 'synthetic', STORAGE_SECRET_ACCESS_KEY: 'synthetic',
  ELEMARKET_LOCATION_PROVIDER: 'geoapify', GEOAPIFY_API_KEY: 'synthetic', ELEMARKET_EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'synthetic', RESEND_FROM_EMAIL: 'sender@example.com', RESEND_WEBHOOK_SECRET: 'synthetic',
  ELEMARKET_OTP_PROVIDER: 'arkesel', ARKESEL_API_KEY: 'synthetic', ARKESEL_OTP_SENDER_ID: 'ELEMARKET', ELEMARKET_PUSH_PROVIDER: 'disabled', ELEMARKET_KYB_PROVIDER: 'manual',
  ELEMARKET_PAYMENT_PROVIDERS: 'processor', ELEMARKET_PAYMENT_PROCESSOR_DRIVER: 'paystack', ELEMARKET_PAYMENT_PROCESSOR_SECRET: 'synthetic', ELEMARKET_SETTLEMENT_MODE: 'provider_direct_uncontrolled',
};

test('selected capabilities require only their own credentials; R2, Hubtel, FCM and Fylings are absent', () => {
  assert.doesNotThrow(() => validateProviderConfiguration(staging));
  assert.ok(!Object.keys(staging).some(k => /CLOUDFLARE|HUBTEL|FCM|FYLINGS|PAYSTACK_SECRET/.test(k)));
});
for (const [component, spec] of Object.entries(components)) {
  test(`${component}: unknown providers fail closed and expose no secret`, () => {
    for (const key of ['uninstalled', '__proto__', 'constructor', 'https://attacker.invalid/module', '../module']) {
      assert.throws(() => selectedProvider(component, { [spec.selection]: key }), /unavailable|invalid/);
    }
  });
  if (!spec.optional) test(`${component}: no implicit vendor or vendor secret when selection is missing`, () => {
    assert.throws(() => selectedProvider(component, {}), new RegExp(`missing configuration ${spec.selection}`));
  });
}
test('unconfigured selected provider names its component and missing configuration', () => {
  const env = { ...staging }; delete env.RESEND_API_KEY;
  assert.throws(() => validateProviderConfiguration(env), /email provider 'resend': missing configuration RESEND_API_KEY/);
});
test('Paystack is not a mandatory selection; unavailable Hubtel/http fail rather than impersonating a provider', () => {
  for (const driver of ['hubtel','http','uninstalled']) assert.throws(() => paymentDriver(driver), /unavailable/);
  const env = { ...staging }; delete env.ELEMARKET_PAYMENT_PROCESSOR_DRIVER;
  assert.throws(() => validateProviderConfiguration(env), /processor.*missing configuration.*DRIVER/);
});
test('production cannot accept uncontrolled settlement or claim a delivery/dispute hold', () => {
  for (const mode of ['provider_direct_uncontrolled','provider_delivery_hold']) {
    assert.throws(() => validateProviderConfiguration({ ...staging, ELEMARKET_ENV: 'production', ELEMARKET_SETTLEMENT_MODE: mode }), /required capability deliveryDisputeHold/);
  }
});
test('provider aliases cannot collide on credential environment names', () => {
  assert.throws(() => validateProviderConfiguration({ ...staging, ELEMARKET_PAYMENT_PROVIDERS: 'bank-a,bank_a' }), /collide/);
});
test('CSP exposes only selected browser transports and rejects directives, wildcard and private origins', () => {
  assert.deepEqual(browserPolicy({}), { script: [], connect: [], build: [] });
  const policy = browserPolicy(staging);
  assert.deepEqual(policy.connect, ['https://objects.example.com']);
  assert.ok(!policy.connect.some(x => /paystack|geoapify|fcm/.test(x)));
  assert.ok(browserPolicy({ ELEMARKET_PUSH_PROVIDER: 'fcm' }).script.includes('https://www.gstatic.com'));
  for (const origin of ['*','https:','https://*.example.com','https://api.example.com;','https://127.0.0.1','https://user:secret@example.com','https://example.com/path']) {
    assert.throws(() => browserPolicy({ ELEMARKET_CSP_CONNECT_SRC: origin }));
  }
});
test('registry rejects environment-controlled modules and malformed adapter capabilities', async () => {
  const registry = loadTypeScript('src/lib/market/adapters/registry.ts', {
    '@/lib/env.server': { isWorkspacePreview: () => false },
    '@/lib/market/provider-policy.server': { normalizeProviderKey: x => x },
    './payment': {}, './builtin-drivers': { builtinDrivers: { incomplete: async () => ({}) } },
  });
  await assert.rejects(() => registry.getPaymentAdapter('processor', 'incomplete'), /required capability/);
  await assert.rejects(() => registry.getPaymentAdapter('processor', 'http'), /unavailable/);
  await assert.rejects(() => registry.getPaymentAdapter('processor', 'constructor'), /unavailable/);
});
test('S3 signing supports configured endpoint/region and preserves private immutable 560 KB uploads', async () => {
  const { S3StorageProvider } = loadTypeScript('src/lib/storage/s3.server.ts', {
    '@/lib/security/ssrf.server': { assertPublicHttpsEndpoint: async x => new URL(x) },
  });
  const provider = new S3StorageProvider({ endpoint: staging.STORAGE_ENDPOINT, region: staging.STORAGE_REGION, bucket: staging.STORAGE_BUCKET, accessKeyId: 'synthetic', secretAccessKey: 'synthetic' });
  const result = await provider.createPresignedUpload({ key: 'profile-image/owner/file.png', contentType: 'image/png', sizeBytes: 560 * 1024 });
  const url = new URL(result.uploadUrl);
  assert.equal(url.origin, staging.STORAGE_ENDPOINT);
  assert.equal(url.pathname, '/private-objects/profile-image/owner/file.png');
  assert.match(url.searchParams.get('X-Amz-Credential'), /eu-west-1\/s3\/aws4_request/);
  assert.equal(result.requiredHeaders['if-none-match'], '*');
  assert.equal(url.searchParams.get('X-Amz-SignedHeaders'), 'content-length;content-type;host;if-none-match');
  await assert.rejects(() => provider.createPresignedUpload({ key: 'file', contentType: 'image/png', sizeBytes: 560 * 1024 + 1 }));
  await assert.rejects(() => provider.createPresignedDownload({ key: '../other-tenant' }));
});
test('storage and delivery reject private, reserved and redirect targets before sending credentials', async () => {
  const { assertPublicHttpsEndpoint } = loadTypeScript('src/lib/security/ssrf.server.ts');
  for (const endpoint of ['http://example.com','https://127.0.0.1','https://169.254.169.254','https://[::1]','https://10.0.0.1','https://user:pass@example.com']) await assert.rejects(() => assertPublicHttpsEndpoint(endpoint));
  for (const file of ['src/lib/storage/s3.server.ts','src/lib/market/adapters/delivery.server.ts','src/lib/kyb/providers/fylings.server.ts']) {
    const source = fs.readFileSync(file,'utf8'); assert.match(source, /assertPublicHttpsEndpoint/); assert.match(source, /redirect: "error"/);
  }
});
test('core modules contain no provider branches, credentials, response signatures or imports', () => {
  for (const file of ['src/lib/market/payment.server.ts','src/lib/market/refunds.server.ts','src/lib/storage/storage.server.ts','src/lib/market/adapters/location.server.ts','src/lib/kyb/index.server.ts','src/lib/auth/otp/otp.server.ts','src/lib/auth/email/email-otp.server.ts','src/lib/auth/email/webhook.server.ts','src/lib/security/headers.ts']) {
    assert.doesNotMatch(fs.readFileSync(file,'utf8'), /paystack|hubtel|cloudflare|geoapify|arkesel|fylings|firebase|['"]resend['"]|['"]fcm['"]/i, file);
  }
});

test('storage streaming validation cancels oversized bodies even with a false Content-Length', async t => {
  const { S3StorageProvider } = loadTypeScript('src/lib/storage/s3.server.ts', { '@/lib/security/ssrf.server': { assertPublicHttpsEndpoint: async x => new URL(x) } });
  let cancelled = false;
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(20)); }, cancel() { cancelled = true; } }), { headers: { 'content-length':'1' } }));
  const provider = new S3StorageProvider({ endpoint:'https://objects.example.com', region:'eu-west-1', bucket:'private-files',accessKeyId:'synthetic',secretAccessKey:'synthetic' });
  await assert.rejects(() => provider.readObject('object',10), /validation read limit/);
  assert.equal(cancelled,true);
});
