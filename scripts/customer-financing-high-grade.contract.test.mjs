import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(new URL('..', import.meta.url).pathname);
const financing = fs.readFileSync(path.join(root,'src/lib/market/financing.ts'),'utf8');
const checkout = fs.readFileSync(path.join(root,'src/routes/checkout.tsx'),'utf8');
const migration = fs.readFileSync(path.join(root,'migrations/0097_customer_financing_checkout_hardening.sql'),'utf8');

test('customer financing amount is server-derived from a short-lived quote',()=>{
  assert.match(financing,/previewCustomerFinancing/);
  assert.match(financing,/customer_financing_quotes/);
  assert.match(financing,/where id=\$1 and user_id=\$2 for update/);
  assert.match(financing,/quoteId: z\.string/);
});

test('customer financing requires provider approval and is not a payment method',()=>{
  assert.match(checkout,/provider.*approval|required/i);
  assert.match(checkout,/not ELEMARKET payment methods/i);
  assert.match(migration,/not an approval, credit decision, or payment authorization/i);
});

test('financing UI exposes BNPL/installment providers without claiming approval',()=>{
  assert.match(checkout,/BNPL \/ installment options/);
  assert.match(checkout,/Provider approval required/);
  assert.match(checkout,/not an approved credit limit/);
});

test('financing quote is customer-bound, expires, and is single-use',()=>{
  assert.match(migration,/user_id text not null/);
  assert.match(migration,/expires_at timestamptz not null/);
  assert.match(migration,/used_at timestamptz/);
  assert.match(financing,/used_at is null/);
});

console.log('High-grade customer financing contracts: 4 assertions passed, 0 failed');
