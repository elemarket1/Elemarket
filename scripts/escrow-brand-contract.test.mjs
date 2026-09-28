import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root = process.cwd();
const migration = fs.readFileSync(path.join(root,'migrations/0021_escrow_settlement_brands.sql'),'utf8');
const hardening = fs.readFileSync(path.join(root,'migrations/0022_escrow_settlement_hardening.sql'),'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const dashboard = fs.readFileSync(path.join(root,'src/routes/merchant/dashboard.tsx'),'utf8');
const dashboardServer = fs.readFileSync(path.join(root,'src/routes/merchant/dashboard.functions.ts'),'utf8');

test('escrow schema has ledger and settlement controls',()=>{
  for (const token of ['create table if not exists escrows','escrow_ledger_entries','merchant_settlements','escrow_disputes','release_escrow','mark_escrow_release_pending','payment_completed_escrow_create']) assert.match(migration,new RegExp(token.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&'),'i'));
});
test('brand verification distinguishes brand from authorization',()=>{
  assert.match(migration,/create table if not exists brands/i); assert.match(migration,/merchant_brand_authorizations/i); assert.match(migration,/official_brand boolean/i); assert.match(migration,/relationship text not null/i);
});
test('canonical Samsung and Hisense are seeded without false official claims',()=>{
  assert.match(migration,/brand_samsung.*Samsung.*samsung.*unverified.*false/is); assert.match(migration,/brand_hisense.*Hisense.*hisense.*unverified.*false/is);
});
test('merchant dashboard exposes marketplace sales reporting rather than settlement balances',()=>{
  for (const token of ['Sales & commission','Product sales','ELEMARKET commission','Merchant order value']) assert.match(dashboard,new RegExp(token,'i'));
  assert.match(dashboardServer,/getMerchantFinanceProvider/i);
  assert.doesNotMatch(dashboard,/Available for withdrawal|Payout processing|Paid out/i);
});


test('settlement remains outside the marketplace application layer',()=>{
  const boundary = fs.readFileSync(path.join(root,'migrations/0059_marketplace_dispute_provider_boundary.sql'),'utf8');
  assert.match(boundary,/payment-provider settlement\/refunds happen outside ELEMARKET/i);
  assert.doesNotMatch(boundary,/insert into merchant_settlements/i);
});
test('provider refund cannot silently contradict released escrow',()=>{
  assert.match(hardening,/guard_payment_refund_against_escrow/i);
  assert.match(hardening,/finalize_escrow_for_refunded_payment/i);
  assert.match(hardening,/refund_pending/i);
});
test('npm test only runs test files that actually ship in this artifact',()=>{
  assert.equal(pkg.scripts.test,"node --test 'scripts/**/*.test.mjs'");
});

test('financial summary includes refund-pending entitlements',()=>{
  assert.match(hardening,/create or replace view merchant_financial_summary/i);
  assert.match(hardening,/refund_pending.*merchant_entitlement/is);
});
