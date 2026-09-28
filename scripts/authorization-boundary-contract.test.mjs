import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("authorization module defines explicit customer/merchant/admin boundaries", () => {
  const src = read("src/lib/auth/authorization.server.ts");
  for (const fn of ["requireCustomer", "requireCustomerOrAdmin", "requireMerchantOrAdmin", "requireAdmin", "requireMerchantAccess"]) {
    assert.match(src, new RegExp(`export async function ${fn}\\b`), `${fn} missing`);
  }
  assert.match(src, /select role from "user" where id = \$1/);
  assert.match(src, /merchant_accounts/);
});

test("customer checkout/payment/financing require the customer role", () => {
  for (const file of [
    "src/lib/market/checkout.ts",
    "src/lib/market/payment.ts",
    "src/lib/market/financing.ts",
  ]) {
    const src = read(file);
    assert.match(src, /requireCustomerForUserId\(context\.userId\)/, `${file} lacks customer authorization`);
  }
});

test("merchant financing requires merchant role and ownership", () => {
  const src = read("src/lib/market/financing.ts");
  assert.match(src, /requireMerchantOrAdminForUserId\(context\.userId\)/);
  assert.match(src, /requireMerchantAccessForUserId\(data\.merchantId, context\.userId\)/);
});

test("authorization is server-only and never accepts a client-supplied role", () => {
  const src = read("src/lib/auth/authorization.server.ts");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "");
  assert.doesNotMatch(code, /request\.json\(\).*role|searchParams.*role|localStorage.*role|sessionStorage.*role/s);
  assert.match(src, /Never accept a role/);
});
