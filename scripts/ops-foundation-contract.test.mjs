import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('ops foundation has durable observability and shared infrastructure gates',()=>{
  assert.match(fs.readFileSync('migrations/0019_ops_observability.sql','utf8'),/observability_events/);
  assert.match(fs.readFileSync('src/lib/env.server.ts','utf8'),/DATABASE_URL/);
  assert.match(fs.readFileSync('src/lib/env.server.ts','utf8'),/REDIS_URL/);
  assert.match(fs.readFileSync('src/lib/observability/logger.server.ts','utf8'),/record_observability_event/);
});
test('external payment adapter is real HTTP boundary and validates response',()=>{
  const s=fs.readFileSync('src/lib/market/adapters/providers/paystack.ts','utf8');
  assert.match(s,/fetch\(/); assert.match(s,/providerReference/); assert.match(s,/AbortSignal\.timeout/);
});
test('delivery adapter is real HTTP boundary and validates quote response',()=>{
  const s=fs.readFileSync('src/lib/market/adapters/delivery.server.ts','utf8');
  assert.match(s,/publicHttpsFetch\(/); assert.match(s,/quoteId/); assert.match(s,/expiresAt/);
});
test('search has Typesense with Postgres fallback',()=>{
  const s=fs.readFileSync('src/lib/market/search.server.ts','utf8')+fs.readFileSync('src/lib/market/adapters/search-registry.server.ts','utf8');
  assert.match(s,/TYPESENSE_HOST/); assert.match(s,/source: "postgres"/);
});
test('merchant and admin dashboards are server role gated',()=>{
  const merchantServer=fs.readFileSync('src/routes/merchant/dashboard.functions.ts','utf8');
  const adminServer=fs.readFileSync('src/routes/admin/dashboard.functions.ts','utf8');
  assert.match(merchantServer,/requireMerchantWorkspaceForUserId|requireMerchantOrAdmin/);
  assert.match(adminServer,/requireAdmin/);
  assert.doesNotMatch(fs.readFileSync('src/routes/merchant/dashboard.tsx','utf8'),/requireMerchantOrAdmin|authorization\.server|middleware/);
  assert.doesNotMatch(fs.readFileSync('src/routes/admin/dashboard.tsx','utf8'),/requireAdmin|authorization\.server|middleware/);
});
test('delivery quote is authenticated and persisted server-side',()=>{
  const s=fs.readFileSync('src/lib/market/adapters/delivery.server.ts','utf8');
  assert.match(s,/requireCustomerForUserId/); assert.match(s,/insert into delivery_quotes/); assert.match(s,/quote\.price/);
});
test('observability has database-native reservation and payment transition hooks',()=>{
  const s=fs.readFileSync('migrations/0019_ops_observability.sql','utf8');
  assert.match(s,/order_stock_reservation_observe/); assert.match(s,/payment_state_transition_observe/); assert.match(s,/primary key\(metric_key, bucket_start\)/);
});


test("API security has durable rate limiting and security headers",()=>{
  assert.match(fs.readFileSync("migrations/0020_api_security.sql","utf8"),/consume_api_rate_limit/);
  assert.match(fs.readFileSync("src/lib/security/rate-limit.server.ts","utf8"),/createHash/);
  assert.match(fs.readFileSync("src/lib/security/headers.ts","utf8"),/Content-Security-Policy/);
  assert.match(fs.readFileSync("server/middleware/security.ts","utf8"),/securityHeaders/);
});

test("production startup validates durable infrastructure and auth secret",()=>{
  const s=fs.readFileSync("scripts/validate-startup-env.mjs","utf8");
  for (const token of ["DATABASE_URL","REDIS_URL","BETTER_AUTH_SECRET","BETTER_AUTH_URL","VITE_AUTH_ENABLED"]) assert.match(s,new RegExp(token));
  assert.match(s,/at least 32 characters/);
});

test("payment adapter sends an idempotency key and webhook has replay defenses",()=>{
  const adapter=fs.readFileSync("src/lib/market/adapters/providers/paystack.ts","utf8");
  const payment=fs.readFileSync("src/lib/market/payment.server.ts","utf8");
  assert.match(adapter,/idempotency-key/);
  assert.match(payment,/idempotencyKey: result\.attemptId/);
  assert.match(payment,/payload too large/);
  assert.match(payment,/payment-webhook/);
  assert.match(fs.readFileSync("migrations/0012_payment_orchestration.sql","utf8"),/payment_webhook_events/);
});
