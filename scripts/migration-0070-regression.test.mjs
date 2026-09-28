import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const migration = await readFile(new URL("../migrations/0070_paystack_refund_non_custodial_migration.sql", import.meta.url), "utf8");

/**
 * These are intentionally source-level migration-chain guards. The deploy CI
 * also runs the complete migration set against a fresh PostgreSQL 16 service.
 */
test("0070 indexes provider refunds by requested_at, not nonexistent created_at", () => {
  assert.match(migration, /provider_refund_requests_order_idx[\s\S]*on provider_refund_requests\(order_id,requested_at desc\)/i);
  assert.doesNotMatch(migration, /provider_refund_requests_order_idx[\s\S]*on provider_refund_requests\(order_id,created_at desc\)/i);
});

test("0070 drops the legacy settlement constraint before provider_direct backfill", () => {
  const drop = migration.indexOf("alter table merchants drop constraint if exists merchants_settlement_model_check;");
  const update = migration.indexOf("update merchants set settlement_model='provider_direct' where settlement_model='marketplace_escrow';");
  const add = migration.indexOf("alter table merchants add constraint merchants_settlement_model_check");
  assert.ok(drop >= 0 && update >= 0 && add >= 0);
  assert.ok(drop < update && update < add, "settlement constraint migration order is unsafe");
});

test("0070 defines only live provider settlement values after migration", () => {
  assert.match(migration, /check \(settlement_model in \('provider_direct','enterprise_direct'\)\)/);
  assert.match(migration, /alter column settlement_model set default 'provider_direct'/);
});

test("0070 keeps provider refunds non-custodial", () => {
  assert.match(migration, /No local release state,[\s\S]*merchant settlement,[\s\S]*escrow balance is changed/i);
  assert.match(migration, /local escrow is disabled; settlement is controlled by the payment provider/i);
});
