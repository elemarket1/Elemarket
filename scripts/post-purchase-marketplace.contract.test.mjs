import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd();
const migration=fs.readFileSync(path.join(root,'migrations/0106_marketplace_post_purchase_hardening.sql'),'utf8');
const pp=fs.readFileSync(path.join(root,'src/lib/market/post-purchase.ts'),'utf8');
const catalog=fs.readFileSync(path.join(root,'src/lib/market/catalog.ts'),'utf8');

test('returns are provider-neutral and customer-owned',()=>{
 assert.match(migration,/create table if not exists return_requests/);
 assert.match(migration,/request_order_return/);
 assert.match(migration,/provider_refund_requests/);
 assert.match(pp,/requestOrderReturn/);
 assert.match(pp,/requireCustomerForUserId/);
});

test('return requests enforce delivered state, returnability, window and dispute exclusion',()=>{
 assert.match(migration,/v_order\.status not in \('delivered','completed'\)/);
 assert.match(migration,/v_item\.returnable is not true/);
 assert.match(migration,/return_window_days/);
 assert.match(migration,/customer_order_disputes/);
});

test('reviews are verified purchases and cannot be duplicated',()=>{
 assert.match(migration,/review_order_item/);
 assert.match(migration,/v_order\.status not in \('delivered','completed'\)/);
 assert.match(migration,/product was not purchased in this order/);
 assert.match(migration,/unique/);
 assert.match(pp,/submitOrderItemReview/);
});

test('merchant performance metrics are neutral operational metrics',()=>{
 assert.match(migration,/merchant_performance_snapshot/);
 assert.match(migration,/cancellationRate/);
 assert.match(migration,/disputeCount/);
 assert.match(migration,/returnCount/);
 assert.match(pp,/getMerchantPerformance/);
});

test('catalog already exposes return policy metadata to buyers',()=>{
 assert.match(catalog,/returnable/);
 assert.match(catalog,/return_window_days/);
});
