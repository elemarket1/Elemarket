import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root = process.cwd();
const payment = fs.readFileSync(path.join(root,'src/lib/market/payment.server.ts'),'utf8');
const policy = fs.readFileSync(path.join(root,'src/lib/market/provider-policy.server.ts'),'utf8');
const migration = fs.readFileSync(path.join(root,'migrations/0024_payment_provider_selection.sql'),'utf8');
const readme = fs.readFileSync(path.join(root,'README.md'),'utf8');

test('ELEMARKET has no proprietary payment-network dependency',()=>{
  assert.doesNotMatch(readme,/ELEPAY/i);
  assert.doesNotMatch(policy,/paystack|hubtel/i);
  assert.match(policy,/normalizeProviderKey/);
});

test('only active database-configured providers may be selected',()=>{
  assert.doesNotMatch(payment,/assertApprovedPaymentProvider/);
  assert.match(payment,/status = 'active'/);
  assert.match(policy,/normalizeProviderKey/);
});

test('provider rows remain review-only until configured and approved',()=>{
  assert.match(migration,/paystack.*mobile_money.*review/is);
  assert.match(migration,/hubtel.*mobile_money.*review/is);
  assert.match(migration,/Never activate a provider merely because its row exists/i);
});
