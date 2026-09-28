import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(new URL('../migrations/0144_provider_neutral_withdrawal_dispute_gate.sql', import.meta.url), 'utf8');

test('withdrawal eligibility uses live customer disputes and never legacy escrow disputes', () => {
  assert.match(migration, /customer_order_disputes/);
  assert.doesNotMatch(migration, /escrow_disputes/);
  assert.doesNotMatch(migration, /merchant_settlements/);
  assert.match(migration, /for update/i);
  assert.match(migration, /24 hours/i);
});

test('merchant withdrawal snapshot is provider-neutral and uses live disputes', async () => {
  const migration = fs.readFileSync(new URL('../migrations/0145_provider_neutral_merchant_withdrawal_snapshot.sql', import.meta.url), 'utf8');
  assert.match(migration,/merchant_provider_withdrawal_eligibility_policy/);
  assert.match(migration,/customer_order_disputes/);
  assert.doesNotMatch(migration,/escrow_disputes/);
});
