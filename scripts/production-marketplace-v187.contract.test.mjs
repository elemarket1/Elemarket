import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const migration = fs.readFileSync(path.join(root, "migrations/0118_production_marketplace_control_plane.sql"), "utf8");
const merchant = fs.readFileSync(path.join(root, "src/routes/merchant/dashboard.functions.ts"), "utf8");
const postPurchase = fs.readFileSync(path.join(root, "src/lib/market/post-purchase.ts"), "utf8");
const orderPage = fs.readFileSync(path.join(root, "src/routes/orders.$id.tsx"), "utf8");

test("production migration disables legacy escrow execution", () => {
  assert.match(migration, /drop trigger if exists payment_completed_escrow_create on payments/i);
  assert.match(migration, /legacy escrow execution is disabled/i);
  assert.match(migration, /legacy escrow release is disabled/i);
  assert.match(migration, /legacy local settlement is disabled/i);
  assert.match(migration, /drop function if exists create_merchant_fund_release_request/i);
});

test("provider eligibility is order/dispute based, not local custody", () => {
  assert.match(migration, /merchant_provider_funds_summary as[\s\S]*from orders o/i);
  assert.match(migration, /customer_order_disputes/);
  assert.doesNotMatch(migration.match(/create or replace view merchant_provider_funds_summary as[\s\S]*?create or replace view merchant_financial_summary as/i)?.[0] ?? "", /from escrows e/i);
});

test("merchant cannot self-certify delivery", () => {
  assert.match(migration, /delivery must be confirmed by the customer or a verified carrier event/i);
  assert.match(migration, /shipment_events se[\s\S]*event_type='delivered'/i);
  assert.match(migration, /delivery_confirmation_source/);
});

test("customer receipt confirmation is authenticated and audited", () => {
  assert.match(migration, /customer_confirm_order_received\(/);
  assert.match(migration, /where id=p_order_id and user_id=p_customer_id for update/);
  assert.match(migration, /customer_confirmation/);
  assert.match(postPurchase, /customer_confirm_order_received\(\$1,\$2\)/);
  assert.match(orderPage, /Confirm I received this order/);
});

test("merchant high-impact operations require fresh session and rate limiting", () => {
  assert.match(merchant, /merchant-listing-create/);
  assert.match(merchant, /merchant-listing-update/);
  assert.match(merchant, /merchant-inventory-adjust/);
  assert.match(merchant, /merchant-order-status/);
  assert.match(merchant, /requireFreshSession\(\)/);
});


test("enterprise feed cannot impersonate an unauthorized canonical brand", () => {
  assert.match(migration, /enforce_enterprise_product_authority/);
  assert.match(migration, /enterprise catalogue product requires a canonical brand/);
  assert.match(migration, /merchant_brand_authorizations a/);
  assert.match(migration, /new\.brand:=v_brand_name/);
  assert.match(migration, /invalid canonical product condition/);
});
