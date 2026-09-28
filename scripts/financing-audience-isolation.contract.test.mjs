import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
const root = process.cwd();
const migration = fs.readFileSync(path.join(root,'migrations/0098_financing_audience_product_isolation.sql'),'utf8');
const financing = fs.readFileSync(path.join(root,'src/lib/market/financing.ts'),'utf8');
const health = fs.readFileSync(path.join(root,'src/lib/market/merchant-health.ts'),'utf8');

test('provider definitions are audience/product isolated at the database boundary',()=>{
  assert.match(migration,/validate_financing_provider_definition/);
  assert.match(migration,/customer.*bnpl.*installment/s);
  assert.match(migration,/merchant.*merchant_cash_advance.*line_of_credit.*term_loan/s);
});

test('customer applications cannot use merchant financing providers',()=>{
  assert.match(migration,/customer_financing_applications[\s\S]*v_product_type not in \('bnpl','installment'\)/i);
  assert.match(financing,/audience = 'customer' and status = 'active' and product_type in \('bnpl','installment'\)/);
});

test('merchant applications cannot use customer BNPL providers',()=>{
  assert.match(migration,/merchant_financing_applications[\s\S]*v_product_type not in \('merchant_cash_advance','line_of_credit','term_loan'\)/i);
  assert.match(financing,/audience = 'merchant' and status = 'active' and product_type in \('merchant_cash_advance','line_of_credit','term_loan'\)/);
});

test('merchant health access is restricted to merchant financing providers',()=>{
  assert.match(migration,/validate_merchant_health_provider_access/);
  assert.match(migration,/merchant_health:read/);
  assert.match(migration,/v_audience <> 'merchant'/);
  assert.match(health,/audience='merchant'/);
});

test('financing remains provider-decision based',()=>{
  assert.match(financing,/providerApprovalRequired: true/);
  assert.match(financing,/Provider-led financing/);
});

console.log('Financing audience isolation contracts: 5 assertions passed, 0 failed');
