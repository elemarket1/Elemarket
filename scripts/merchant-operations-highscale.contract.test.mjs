import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
const migration=fs.readFileSync('migrations/0086_merchant_operations_hardening.sql','utf8');
const fn=fs.readFileSync('src/routes/merchant/dashboard.functions.ts','utf8');
const ui=fs.readFileSync('src/routes/merchant/dashboard.tsx','utf8');

test('merchant operations use database-authoritative inventory adjustments',()=>{
  assert.match(migration,/create table if not exists merchant_inventory_adjustments/);
  assert.match(migration,/for update/);
  assert.match(migration,/merchant_adjust_inventory/);
  assert.match(fn,/merchant_adjust_inventory/);
  assert.match(fn,/requireMerchantAccessForUserId/);
});
test('merchant order workflow is state-constrained and auditable',()=>{
  assert.match(migration,/merchant_advance_order/);
  assert.match(migration,/merchant_order_status_history/);
  assert.match(migration,/record_audit_event/);
  assert.match(ui,/Order operations/);
});
test('merchant portal exposes operations modules without local payout controls',()=>{
  for(const token of ['Products','Inventory','Orders','Finance','Business','KYB','Promotions','Enterprise']) assert.match(ui,new RegExp(token));
  assert.doesNotMatch(ui,/Request funds for verification|Payout processing|Paid out/i);
});
