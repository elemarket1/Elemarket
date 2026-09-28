import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync("migrations/0119_production_refund_and_cancellation_hardening.sql", "utf8");
const orders = fs.readFileSync("src/lib/market/orders.ts", "utf8");
const paystack = fs.readFileSync("src/lib/market/adapters/providers/paystack.ts", "utf8");
const admin = fs.readFileSync("src/routes/admin/dashboard.functions.ts", "utf8");

test("customer cancellation refund is locked to paid/confirmed order states", () => {
  assert.match(migration, /select \* into v_order from orders where id=v_payment\.order_id and payment_id=v_payment\.id for update/);
  assert.match(migration, /v_order\.status not in \('paid','confirmed'\)/);
  assert.match(migration, /set status='refund_pending'/);
  assert.match(orders, /Order is no longer cancellable/);
});

test("customer cancellation requires a fresh session", () => {
  assert.match(orders, /customer-order-cancel/);
  assert.match(orders, /requireFreshSession\(\)/);
});

test("Paystack full-refund contract rejects partial provider refunds", () => {
  assert.match(paystack, /providerAmount !== amountMinor/);
});

test("admin provider refunds have a dedicated abuse limit", () => {
  assert.match(admin, /admin-provider-refund/);
});
