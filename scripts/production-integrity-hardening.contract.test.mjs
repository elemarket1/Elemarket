import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(new URL("../migrations/0101_production_integrity_hardening.sql", import.meta.url), "utf8");
const financing = fs.readFileSync(new URL("../src/lib/market/financing.ts", import.meta.url), "utf8");

 test("live settlement defaults are provider-managed, never marketplace escrow", () => {
  assert.match(migration, /set settlement_model='provider_direct'/i);
  assert.match(migration, /set default 'provider_direct'/i);
  assert.match(migration, /enterprise_direct/);
  assert.doesNotMatch(migration, /add constraint merchants_settlement_model_check[\s\S]*marketplace_escrow/);
});

test("security-definer financing functions use a pinned search path and restricted execute privilege", () => {
  assert.match(migration, /start_customer_financing_application[\s\S]*set search_path = pg_catalog, public/i);
  assert.match(migration, /start_merchant_financing_application[\s\S]*set search_path = pg_catalog, public/i);
  assert.match(migration, /revoke execute on function start_customer_financing_application/i);
  assert.match(migration, /grant execute on function start_customer_financing_application[\s\S]*to current_user/i);
});

test("customer financing preview requires products to be financing-eligible", () => {
  assert.match(financing, /select price::text,merchant_id,stock,financing_eligible from products/i);
  assert.match(financing, /!product\[0\]\.financing_eligible/);
});

test("customer financing delivery quotes must cover the exact cart merchant set", () => {
  assert.match(financing, /quoteMerchantIds/);
  assert.match(financing, /cartMerchantIds/);
  assert.match(financing, /Financing delivery quotes do not match the cart merchants/);
});
