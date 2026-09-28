import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(p, "utf8");

test("frontend checkout creates server payment intents and redirects to provider checkout", () => {
  const code = read("src/routes/checkout.tsx");
  assert.match(code, /createPaymentIntent/);
  assert.match(code, /checkoutUrl/);
  assert.match(code, /window\.location\.href = firstCheckoutUrl/);
  assert.match(code, /const queue: Array<\{ paymentId: string \}>/);
  assert.doesNotMatch(code, /queue\[0\]\.checkoutUrl/);
  assert.doesNotMatch(code, /ELEMARKET_PAYMENT_PAYSTACK_SECRET/);
});

test("payment return page waits for server payment status and supports sequential merchant payments", () => {
  const code = read("src/routes/payment.return.tsx");
  assert.match(code, /getCustomerPaymentStatus/);
  assert.match(code, /payment-queue:v1/);
  assert.match(code, /result\.status === "completed"/);
});

test("checkout binds active provider in the database instead of legacy external placeholders", () => {
  const sql = read("migrations/0029_live_checkout_provider_binding.sql");
  assert.match(sql, /pp\.status = 'active'/);
  assert.match(sql, /v_provider_key/);
  assert.match(sql, /No active payment provider configured/);
});
