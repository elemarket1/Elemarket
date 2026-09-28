import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const migration = fs.readFileSync(path.join(root,'migrations','0111_global_marketplace_control_plane_hardening.sql'),'utf8');

test('inventory idempotency keys are bound to operation parameters', () => {
  assert.match(migration, /operation_fingerprint/);
  assert.match(migration, /idempotency key payload mismatch/);
  assert.match(migration, /concat_ws\('\|','reserve',p_location_id,p_product_id,p_quantity,p_reference_id\)/);
});

test('serialized unit validation enforces enterprise, merchant and product consistency', () => {
  assert.match(migration, /v_product_merchant is distinct from v_enterprise_merchant/);
  assert.match(migration, /v_merchant is distinct from v_product_merchant/);
});

test('fulfillment allocation locks the order before aggregate quantity validation', () => {
  assert.match(migration, /for update of o/);
  assert.match(migration, /allocation merchant mismatch/);
  assert.match(migration, /fulfillment allocation exceeds ordered quantity/);
});

test('service cases bind order item, product and serialized unit', () => {
  assert.match(migration, /service case order item mismatch/);
  assert.match(migration, /service case product\/order item mismatch/);
  assert.match(migration, /service case serial\/product mismatch/);
});

test('inventory transfers enforce same enterprise and merchant graph', () => {
  assert.match(migration, /transfer location organization mismatch/);
  assert.match(migration, /transfer merchant\/product mismatch/);
});
