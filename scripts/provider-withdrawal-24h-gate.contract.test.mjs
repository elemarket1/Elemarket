import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  new URL("../migrations/0090_provider_withdrawal_24h_dispute_gate.sql", import.meta.url),
  "utf8",
);

test("provider withdrawal gate requires 24h after delivered", () => {
  assert.match(migration, /v_delivered_at \+ interval '24 hours'/);
  assert.match(migration, /now\(\) < v_eligible_at/);
});

test("provider withdrawal gate blocks disputes and refund states", () => {
  assert.match(migration, /status in \('open','under_review'\)/);
  assert.match(migration, /customer_dispute_filed_within_24_hours/);
  assert.match(migration, /status in \('cancelled','refund_pending','refunded','disputed'\)/);
});

test("customer dispute and withdrawal eligibility serialize on the order row", () => {
  assert.match(migration, /where o\.id=p_order_id and o\.merchant_id=p_merchant_id\s+for update/);
  assert.match(migration, /where o\.id=p_order_id\s+for update/);
});

test("ELEMARKET remains provider-managed and non-custodial", () => {
  assert.match(migration, /custodyBoundary','external_provider'/);
  assert.match(migration, /withdrawalAction','provider_managed'/);
  assert.doesNotMatch(migration, /insert into merchant_settlements/i);
});
