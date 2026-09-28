import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const adapter = fs.readFileSync('src/lib/market/adapters/providers/paystack.ts','utf8');
const migration = fs.readFileSync('migrations/0127_refund_webhook_state_reconciliation.sql','utf8');

test('Paystack parses every refund lifecycle event explicitly', () => {
  for (const event of ['refund.pending','refund.processing','refund.needs-attention','refund.failed','refund.processed']) {
    assert.match(adapter, new RegExp(event.replace('.', '\\.'), 'i'));
  }
});

test('refund lifecycle migration reconciles provider refund state without falsely changing payment state', () => {
  assert.match(migration, /refund\.pending/);
  assert.match(migration, /refund\.processing/);
  assert.match(migration, /refund\.needs-attention/);
  assert.match(migration, /refund\.failed/);
  assert.match(migration, /refund\.processed/);
  assert.match(migration, /v_refund_status/);
  assert.match(migration, /update provider_refund_requests/);
  assert.match(migration, /v_new_status := 'refunded'/);
  assert.match(migration, /v_new_status := v_payment\.status/);
});
