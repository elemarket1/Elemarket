import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const orders = fs.readFileSync('src/lib/market/orders.ts','utf8');
const financing = fs.readFileSync('src/lib/market/financing.ts','utf8');
const migration = fs.readFileSync('migrations/0092_customer_dispute_runtime_hardening.sql','utf8');
const financingMigration = fs.readFileSync('migrations/0093_customer_financing_idempotency.sql','utf8');
const merchant = fs.readFileSync('src/routes/merchant/dashboard.functions.ts','utf8');
const customerRoutes = ['src/routes/checkout.tsx','src/routes/payment.return.tsx','src/routes/payment.preview.tsx','src/routes/reset-password.tsx','src/routes/profile.tsx'];

test('customer disputes use provider-neutral runtime records',()=>{
 assert.match(migration,/create table if not exists customer_order_disputes/);
 assert.match(migration,/create unique index if not exists customer_order_disputes_active_order_uq/);
 assert.match(migration,/create or replace function open_customer_order_dispute/);
 assert.match(migration,/create or replace function prepare_provider_refund_for_dispute/);
 assert.doesNotMatch(orders,/escrow_disputes/);
});

test('merchant withdrawal gate reads provider-neutral customer disputes',()=>{
 assert.doesNotMatch(merchant,/escrow_disputes/);
 assert.match(merchant,/customer_order_disputes/);
});

test('customer cancellation and dispute paths are rate limited',()=>{
 assert.match(orders,/customer-order-cancel/);
 assert.match(orders,/customer-order-dispute/);
 assert.match(orders,/customer-order-dispute-order/);
});

test('customer financing has abuse rate limiting and idempotency',()=>{
 assert.match(financing,/customer-financing-start/);
 assert.match(financing,/idempotency_key/);
 assert.match(financingMigration,/customer_financing_idempotency_uq/);
});

test('customer frontend does not expose raw server exception messages in key payment flows',()=>{
 for (const file of customerRoutes) {
   const source=fs.readFileSync(file,'utf8');
   assert.doesNotMatch(source,/setError\([^\n]*\.(?:message|stack)/);
 }
});

test('customer order center exists',()=>{
 assert.ok(fs.existsSync('src/routes/orders.tsx'));
 assert.ok(fs.existsSync('src/routes/orders.$id.tsx'));
});
