import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('provider-neutral settlement contract removes provider delivery-hold capability', async () => {
  const catalog = await readFile('src/lib/providers/catalog.mjs', 'utf8');
  const migration = await readFile('migrations/0143_remove_provider_settlement_control_capability.sql', 'utf8');
  const configure = await readFile('scripts/configure-payment-providers.mjs', 'utf8');
  const runtime = await readFile('scripts/validate-runtime-db.mjs', 'utf8');
  assert.doesNotMatch(catalog, /deliveryDisputeHold/);
  assert.doesNotMatch(catalog, /provider_delivery_hold|provider_direct_uncontrolled/);
  assert.match(migration, /drop column if exists delivery_dispute_hold/i);
  assert.doesNotMatch(configure, /delivery_dispute_hold/);
  assert.doesNotMatch(runtime, /delivery_dispute_hold/);
});
