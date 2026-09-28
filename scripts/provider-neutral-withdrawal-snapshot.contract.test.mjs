import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('merchant withdrawal snapshot uses live disputes and never legacy escrow disputes', async () => {
  const migration = await readFile('migrations/0145_provider_neutral_merchant_withdrawal_snapshot.sql','utf8');
  assert.match(migration,/create or replace function merchant_provider_withdrawal_eligibility_policy/i);
  assert.match(migration,/from customer_order_disputes d/i);
  assert.doesNotMatch(migration,/from escrow_disputes d/i);
  assert.doesNotMatch(migration,/insert into merchant_settlements/i);
  assert.doesNotMatch(migration,/release_escrow/i);
});
