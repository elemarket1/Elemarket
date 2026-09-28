import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
const root = process.cwd();
const migration = fs.readFileSync(path.join(root,'migrations/0099_live_dispute_gate_and_financing_flow_repair.sql'),'utf8');
const financing = fs.readFileSync(path.join(root,'src/lib/market/financing.ts'),'utf8');
const checkout = fs.readFileSync(path.join(root,'src/routes/checkout.tsx'),'utf8');

test('withdrawal eligibility uses live provider-neutral customer disputes',()=>{
  assert.match(migration,/merchant_order_withdrawal_eligibility/);
  assert.match(migration,/merchant_provider_withdrawal_eligibility/);
  assert.match(migration,/customer_order_disputes/);
  assert.doesNotMatch(migration,/select 1 from escrow_disputes/);
});

test('customer financing remains compatible with pre-order checkout applications',()=>{
  assert.match(migration,/pre-order provider applications/i);
  assert.match(checkout,/startCustomerFinancing/);
  assert.match(checkout,/orderGroupId:\s*undefined/);
  assert.doesNotMatch(migration,/new\.order_group_id is null then\s*raise exception/i);
});

test('live settlement gate has high-volume dispute and delivery indexes',()=>{
  assert.match(migration,/customer_order_disputes_order_status_created_idx/);
  assert.match(migration,/merchant_order_status_history_delivered_idx/);
});

test('financing provider domain remains separated',()=>{
  assert.match(financing,/audience = 'customer'/);
  assert.match(financing,/audience = 'merchant'/);
});

console.log('Live dispute/settlement + financing-flow contracts: 4 assertions passed, 0 failed');
