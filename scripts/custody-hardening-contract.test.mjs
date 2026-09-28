import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root = process.cwd();
const m23 = fs.readFileSync(path.join(root,'migrations/0023_bank_custody_reconciliation.sql'),'utf8');
const finance = fs.readFileSync(path.join(root,'src/lib/market/merchant-finance.server.ts'),'utf8');
const adapterPath = path.join(root,'src/lib/market/custody-provider.server.ts');

test('custody layer is bank/PSP/EMI aware and never claims custody',()=>{
  assert.match(m23,/create table if not exists custody_providers/i);
  assert.match(m23,/provider_type.*bank.*psp.*emi/is);
  assert.match(m23,/escrow_custody_refs/i);
});
test('settlements have deterministic idempotency and attempt records',()=>{
  assert.match(m23,/settlement_attempts/i);
  assert.match(m23,/idempotency_key text not null unique/i);
  assert.match(m23,/create_settlement_attempt/i);
  assert.match(m23,/confirm_settlement_attempt/i);
});
test('reconciliation exceptions are first-class',()=>{
  assert.match(m23,/reconciliation_runs/i);
  assert.match(m23,/reconciliation_exceptions/i);
  assert.match(m23,/amount_mismatch/i);
});
test('customer cannot self-confirm delivery before shipment',()=>{
  assert.match(m23,/confirm_order_delivery_for_escrow/i);
  assert.match(m23,/if v_o\.status <> 'shipped' then raise exception 'customer can confirm delivery only after shipment'/i);
});
test('merchant application layer has no local custody adapter',()=>{
  assert.equal(fs.existsSync(adapterPath), false);
  assert.doesNotMatch(finance,/escrow|release_escrow|merchant_settlements/i);
});
test('provider settlement remains an external boundary',()=>{
  assert.match(m23,/Opaque provider token\/reference only/i);
  assert.match(m23,/provider_reference/i);
});
test('payment completion is not treated as bank custody confirmation',()=>{
  assert.match(m23,/state.*'funding_pending'/is);
  assert.match(m23,/confirm_escrow_funding/i);
  assert.match(m23,/custody_reference/i);
});
test('brand authorization verification requires evidence and admin identity',()=>{
  assert.match(m23,/verify_merchant_brand_authorization/i);
  assert.match(m23,/verification evidence required/i);
});
