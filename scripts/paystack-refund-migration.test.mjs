import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import fs from "node:fs";

const migration = await readFile(new URL("../migrations/0070_paystack_refund_non_custodial_migration.sql", import.meta.url), "utf8");
const payment = await readFile(new URL("../src/lib/market/payment.server.ts", import.meta.url), "utf8");
const paystack = await readFile(new URL("../src/lib/market/adapters/providers/paystack.ts", import.meta.url), "utf8");
const orders = await readFile(new URL("../src/lib/market/orders.ts", import.meta.url), "utf8");

test("refund migration disables live escrow trigger and creates provider refund ledger", () => {
  assert.match(migration, /drop trigger if exists payment_completed_escrow_create/);
  assert.match(migration, /create table if not exists provider_refund_requests/);
  assert.match(migration, /prepare_provider_refund_for_payment/);
  assert.match(migration, /prepare_provider_refund_for_dispute/);
  assert.match(migration, /settlement\/refunds are authoritative/i);
});

test("refund execution is provider API based", () => {
  assert.match(paystack, /POST|\/refund/);
  assert.match(paystack, /transaction: input\.providerReference/);
  assert.match(paystack, /idempotencyKey/);
  assert.match(payment, /providerRefundId/);
});

test("customer cancellation prepares provider refund instead of releasing paid stock", () => {
  assert.match(orders, /prepare_provider_refund_for_payment/);
  assert.match(orders, /executeProviderRefund/);
  assert.match(orders, /refund_pending/);
});

test("refund completion releases consumed inventory only after provider webhook", () => {
  assert.match(migration, /status='released',released_at=now\(\).*status='consumed'/s);
  assert.match(migration, /update orders set status='refunded'/);
});

test("Paystack refund webhooks correlate by transaction_reference and track refund states", () => {
  assert.match(paystack, /transaction_reference/);
  assert.match(paystack, /refund\.pending/);
  assert.match(paystack, /refund\.processing/);
  assert.match(paystack, /refund\.needs-attention/);
  assert.match(paystack, /refund\.failed/);
  assert.match(paystack, /refund\.processed/);
});


test("refund execution claims the request before the provider call", () => {
  const refunds = requireText("src/lib/market/refunds.server.ts");
  assert.match(refunds, /update provider_refund_requests[\s\S]*status='processing'/);
  assert.match(refunds, /where id=\$1 and status='requested'/);
});

test("admin dispute refund actually invokes the provider refund adapter", () => {
  const dashboard = requireText("src/routes/admin/dashboard.functions.ts");
  assert.match(dashboard, /executeProviderRefund/);
});

test("paystack refund validates returned transaction and amount", () => {
  assert.match(paystack, /Provider refund amount is invalid/);
  assert.match(paystack, /Provider refund transaction mismatch/);
});

function requireText(path) {
  return fs.readFileSync(new URL("../" + path, import.meta.url), "utf8");
}


test("merchant finance does not expose legacy local release balances", () => {
  const finance = requireText("src/lib/market/merchant-finance.server.ts");
  assert.match(finance, /Settlement is external/);
  assert.match(finance, /providerHeldEligible: "0\.00"/);
  assert.match(finance, /pendingReleaseRequests/);
  assert.match(finance, /provider_refund_requests/);
});

test("payment webhook binds to payment attempts before the payment reference copy", () => {
  assert.match(migration, /from payment_attempts pa[\s\S]*join payments p on p\.id=pa\.payment_id/);
  assert.match(migration, /pa\.provider_reference=p_provider_reference/);
});

test("late charge cannot turn a cancelled order into a refunded order", () => {
  assert.match(migration, /if v_order\.status <> 'payment_pending' then/);
  assert.match(migration, /update orders set status='paid'[\s\S]*where id=v_order\.id and status='payment_pending'/);
});
