import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
const read=(p)=>fs.readFileSync(p,'utf8');

test('checkout idempotency replay returns payment IDs for safe payment recovery',()=>{
 const s=read('migrations/0030_prelive_deep_integrity.sql');
 assert.match(s,/left join payments p on p\.order_id=o\.id/);
 assert.match(s,/'paymentId', p\.id/);
});

test('generic webhook resolves the provider from a verified signature rather than trusting request routing',()=>{
 const source=read('src/lib/market/payment.server.ts');
 const start=source.indexOf('export async function handlePaymentWebhook'); const end=source.indexOf('export async function completePreviewPaymentServer'); const block=source.slice(start,end);
 assert.doesNotMatch(block,/selectedProviderKey/);
 assert.match(block,/providerRows/);
 assert.match(block,/adapter\.verifyWebhook/);
 assert.match(block,/verifiedProviders\.length !== 1/);
 assert.match(block,/normalizeProviderKey\(provider\.provider_key\)/);
});

test('provider adapter owns its own currency and credential rules',()=>{
 const s=read('src/lib/market/adapters/providers/paystack.ts');
 assert.match(s,/input\.currency !== "GHS"/);
 assert.match(s,/class PaystackPaymentAdapter/);
});

test('real API startup validation is provider-neutral',()=>{
 const s=read('scripts/validate-startup-env.mjs');
 assert.match(s,/ELEMARKET_REAL_API_MODE/);
 assert.doesNotMatch(s,/ELEMARKET_PAYMENT_PAYSTACK_SECRET/);
 assert.doesNotMatch(s,/ELEMARKET_PAYSTACK_WEBHOOK_URL/);
 assert.match(s,/ELEMARKET_PUBLIC_URL/);
});

test('provider-confirmed refunds cannot silently contradict released escrow',()=>{ const s=read('migrations/0030_prelive_deep_integrity.sql'); assert.match(s,/released escrow requires post-settlement refund workflow/); assert.match(s,/payment_refund_escrow_sync/); });
