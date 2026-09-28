import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('delivery quote HTTP route cannot bypass function middleware authentication', () => {
  const s = fs.readFileSync('src/routes/api.delivery.quote.ts','utf8');
  assert.match(s, /assertSameSiteRequest\(\)/);
  assert.match(s, /requireUserId\(\)/);
  assert.match(s, /requireCustomer\(userId\)/);
  assert.match(s, /requestDeliveryQuoteServer\(\{ data, userId \}\)/);
  assert.doesNotMatch(s, /requestDeliveryQuote\(\{ data:/);
});

test('external catalog SSRF defense validates DNS and blocks redirects', () => {
  const ssrf = fs.readFileSync('src/lib/security/ssrf.server.ts','utf8');
  const catalog = fs.readFileSync('src/lib/market/enterprise-catalog.server.ts','utf8');
  assert.match(ssrf, /lookup\(/);
  assert.match(ssrf, /isPrivateOrReservedIp/);
  assert.match(ssrf, /protocol !== "https:"/);
  assert.match(catalog, /assertPublicHttpsEndpoint/);
  assert.match(catalog, /redirect: "manual"/);
  assert.match(catalog, /redirects are not allowed/);
});

test('webhook routes bound request bodies and do not echo provider internals', () => {
  const payment = fs.readFileSync('src/routes/api.payments.webhook.ts','utf8');
  const enterprise = fs.readFileSync('src/routes/api.enterprise.catalog.webhook.ts','utf8');
  assert.match(payment, /content-length/);
  assert.match(payment, /rawBody\.length/);
  assert.match(payment, /Webhook rejected/);
  assert.doesNotMatch(payment, /new Response\(message/);
  assert.match(enterprise, /content-length/);
  assert.match(enterprise, /readBodyWithLimit/);
  assert.doesNotMatch(enterprise, /Payload too large \(\$\{rawBody\.length\}\)/);
  assert.doesNotMatch(enterprise, /error instanceof Error \? error\.message/);
});


test('security headers include clickjacking and cross-origin isolation controls', () => {
  const s = fs.readFileSync('src/lib/security/headers.ts','utf8');
  for (const token of ['X-Frame-Options','Cross-Origin-Resource-Policy','X-Permitted-Cross-Domain-Policies','Origin-Agent-Cluster']) assert.match(s, new RegExp(token));
});
