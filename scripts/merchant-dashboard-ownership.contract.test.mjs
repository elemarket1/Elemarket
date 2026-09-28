import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const fn = fs.readFileSync(new URL("../src/routes/merchant/dashboard.functions.ts", import.meta.url), "utf8");
const ui = fs.readFileSync(new URL("../src/routes/merchant/dashboard.tsx", import.meta.url), "utf8");

test("merchant dashboard scopes every merchant query to active ownership", () => {
  assert.match(fn, /requireMerchantWorkspaceForUserId/);
  assert.match(fn, /merchantIds/);
  assert.match(fn, /where m\.id = any\(\$1::text\[\]\)/);
  assert.doesNotMatch(fn, /principal\.role === "admin" \? null/);
});

test("merchant dashboard exposes owned listings and merchant activities", () => {
  assert.match(fn, /from products/);
  assert.match(fn, /from orders/);
  assert.match(fn, /activities/);
  assert.match(ui, /My item listings/);
  assert.match(ui, /Merchant activities/);
  assert.match(ui, /Sales & commission/);
});
