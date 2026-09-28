import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const adapter = fs.readFileSync("src/lib/market/adapters/merchant-finance.ts", "utf8");
const service = fs.readFileSync("src/lib/market/merchant-finance.server.ts", "utf8");
const dashboard = fs.readFileSync("src/routes/merchant/dashboard.tsx", "utf8");
const functions = fs.readFileSync("src/routes/merchant/dashboard.functions.ts", "utf8");
const migration = fs.readFileSync("migrations/0047_merchant_finance_read_model.sql", "utf8");

test("merchant finance is provider-neutral", () => {
  assert.match(adapter, /MerchantFinanceProvider/);
  assert.doesNotMatch(adapter, /Hubtel|Paystack|Fylings|Arkesel|Resend/i);
  assert.match(service, /MarketplaceSalesProvider/);
});

test("merchant dashboard exposes marketplace sales reporting", () => {
  for (const token of ["totalSales", "platformCommission", "merchantOrderValue", "refundExceptionAmount"]) {
    assert.match(service, new RegExp(token));
    assert.match(dashboard, new RegExp(token));
  }
  assert.match(dashboard, /Provider refunds/);
  assert.match(functions, /getMerchantFinanceProvider/);
  assert.doesNotMatch(dashboard, /Available for withdrawal|Payout processing|Paid out/i);
});

test("legacy finance migration is retained only for database compatibility", () => {
  assert.match(migration, /merchant_financial_summary/);
});
