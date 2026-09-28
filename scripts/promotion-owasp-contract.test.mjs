import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(new URL("../migrations/0063_promotions_owasp_hardening.sql", import.meta.url), "utf8");
const checkout = fs.readFileSync(new URL("../src/lib/market/checkout.ts", import.meta.url), "utf8");
const ui = fs.readFileSync(new URL("../src/routes/checkout.tsx", import.meta.url), "utf8");
const limiter = fs.readFileSync(new URL("../src/lib/security/rate-limit.server.ts", import.meta.url), "utf8");

test("promo engine is server-authoritative and atomic", () => {
  assert.match(migration, /create table if not exists promotions/);
  assert.match(migration, /for update;\s+if not found or v_promo\.status<>'active'/);
  assert.match(migration, /usage_limit is not null/);
  assert.match(migration, /per_customer_limit/);
  assert.match(migration, /promotion_redemptions\(id,promotion_id,order_id,user_id,code_snapshot,discount_amount,status\)/);
  assert.match(migration, /create trigger promotion_redemption_order_status/);
  assert.match(migration, /status='released'/);
  assert.match(migration, /status='applied'/);
});

test("promo scope and eligibility are enforced against authoritative catalog data", () => {
  assert.match(migration, /promotion_products/);
  assert.match(migration, /promotion_categories/);
  assert.match(migration, /v_has_product_scope/);
  assert.match(migration, /v_has_category_scope/);
  assert.match(migration, /promotion does not apply to this cart/);
  assert.match(migration, /promotion minimum basket not reached/);
});

test("promo discount cannot alter delivery pricing and is bounded by eligible merchandise", () => {
  assert.match(migration, /v_promo_discount:=greatest\(least\(v_promo_discount,v_eligible_subtotal\),0\)/);
  assert.match(migration, /v_delivery:=v_quote\.price/);
  assert.match(migration, /promo_discount,promo_code,promo_id,flash_sale_id,original_product_total/);
  assert.match(migration, /original_product_total = product_total \+ promo_discount/);
  assert.match(migration, /v_product_total\+v_delivery/);
});

test("promo checkout is rate limited and input constrained", () => {
  assert.match(checkout, /promoCode: z\.string\(\)\.trim\(\)\.max\(64\)\.regex/);
  assert.match(checkout, /enforceRateLimit\("checkout-create"/);
  assert.match(checkout, /create_pending_order\(\$1, \$2, \$3, \$4::jsonb, \$5::jsonb, \$6, \$7, \$8\)/);
});

test("frontend treats promo as an untrusted code, never a discount amount", () => {
  assert.match(ui, /promoCode/);
  assert.match(ui, /Discounts are re-validated server-side/);
  assert.doesNotMatch(ui, /discountAmount|discount_total|promoDiscount.*setState/);
});

test("rate limiting never trusts forwarded client IP headers unless proxy trust is explicitly enabled", () => {
  assert.match(limiter, /ELEMARKET_TRUST_PROXY === "1"/);
  assert.match(limiter, /return "direct"/);
});
