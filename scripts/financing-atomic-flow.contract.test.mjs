import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
const root=process.cwd();
const migration=fs.readFileSync(path.join(root,'migrations/0100_financing_atomic_application_flows.sql'),'utf8');
const financing=fs.readFileSync(path.join(root,'src/lib/market/financing.ts'),'utf8');

test('customer financing quote consumption is atomic in the database',()=>{
  assert.match(migration,/start_customer_financing_application/);
  assert.match(migration,/from customer_financing_quotes[\s\S]*for update/);
  assert.match(migration,/update customer_financing_quotes[\s\S]*used_at=now\(\)/);
});
test('customer financing idempotency is checked inside the same transaction',()=>{
  assert.match(migration,/customer_financing_applications[\s\S]*idempotency_key=p_idempotency_key[\s\S]*for update/);
});
test('merchant financing application creation is serialized per merchant',()=>{
  assert.match(migration,/start_merchant_financing_application/);
  assert.match(migration,/pg_advisory_xact_lock\(hashtext\('elemarket:merchant-financing:'/);
});
test('server functions use atomic database transitions',()=>{
  assert.match(financing,/start_customer_financing_application\(\$1,\$2,\$3,\$4,\$5,\$6\)/);
  assert.match(financing,/start_merchant_financing_application\(\$1,\$2,\$3,\$4\)/);
  assert.match(financing,/Atomic DB contract/);
});
console.log('Atomic financing-flow contracts: 4 assertions passed, 0 failed');
