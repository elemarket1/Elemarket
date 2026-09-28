import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const sql = fs.readFileSync('migrations/0027_escrow_dispute_release_hardening.sql','utf8');

test('dispute release requires a verified merchant payout destination',()=>{
  assert.match(sql,/merchant_payout_accounts/i);
  assert.match(sql,/status='verified'/i);
  assert.match(sql,/payout account is not verified/i);
  assert.match(sql,/payout_destination_ref/i);
});

test('dispute refund remains refund_pending until provider confirmation',()=>{
  assert.match(sql,/state='refund_pending'/i);
  assert.doesNotMatch(sql,/state='refunded'/i);
});
