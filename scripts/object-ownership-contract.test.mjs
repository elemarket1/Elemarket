import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("object ownership helpers bind sensitive objects to principal", () => {
  const source = read("src/lib/market/ownership.server.ts");
  assert.match(source, /where id = \$1 and user_id = \$2/);
  assert.match(source, /where id = \$1 and merchant_id = \$2/);
  assert.match(source, /p\.id = \$1 and p\.user_id = \$2 and o\.user_id = \$2/);
  assert.match(source, /where id = \$1 and user_id = \$2/);
});

test("customer and merchant order handlers enforce object ownership", () => {
  const source = read("src/lib/market/orders.ts");
  assert.match(source, /requireCustomerOrder\(data\.orderId, userId\)/);
  assert.match(source, /requireMerchantAccessForUserId\(data\.merchantId, context\.userId\)/);
  assert.match(source, /requireMerchantOrder\(data\.orderId, data\.merchantId\)/);
  assert.match(source, /release_order_stock/);
});

test("payment and financing paths use ownership-bound lookups", () => {
  const payment = read("src/lib/market/payment.server.ts");
  const financing = read("src/lib/market/financing.ts");
  assert.match(payment, /requireCustomerPayment\(input\.paymentId, input\.userId\)/);
  assert.match(financing, /requireCustomerFinancingApplication\(data\.applicationId, userId\)/);
  assert.match(financing, /requireMerchantFinancingApplication\(data\.applicationId, data\.merchantId\)/);
});

test("database prevents payment/order cross-user ownership", () => {
  const migration = read("migrations/0014_object_ownership.sql");
  assert.match(migration, /validate_payment_order_owner/);
  assert.match(migration, /new\.user_id <> v_user/);
  assert.match(migration, /payments_order_owner_validate/);
});

test("v1.35 migration is ordered after v1.34 auth authorization hardening", () => {
  const files = fs.readdirSync(path.join(root, "migrations")).filter((f) => /^\d+.*\.sql$/.test(f)).sort();
  assert.ok(files.indexOf("0013_auth_hardening.sql") < files.indexOf("0014_object_ownership.sql"));
});
