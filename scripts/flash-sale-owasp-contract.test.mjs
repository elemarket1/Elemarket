import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const checkout = fs.readFileSync(new URL("../migrations/0063_promotions_owasp_hardening.sql", import.meta.url), "utf8");
const hardening = fs.readFileSync(new URL("../migrations/0064_flash_sales_price_history_hardening.sql", import.meta.url), "utf8");

 test("flash sales have explicit lifecycle, allocation and customer redemption state", () => {
  assert.match(checkout, /create table if not exists flash_sales/);
  assert.match(checkout, /create table if not exists flash_sale_items/);
  assert.match(checkout, /reserved_quantity/);
  assert.match(checkout, /sold_quantity/);
  assert.match(checkout, /create table if not exists flash_sale_redemptions/);
  assert.match(checkout, /per_customer_limit/);
});

test("flash sale checkout is atomic and refuses stacking", () => {
  assert.match(checkout, /select \* into v_flash_sale from flash_sales where id=v_flash_sale_id for update/);
  assert.match(checkout, /promotion cannot be combined with a flash sale/);
  assert.match(checkout, /reserved_quantity=reserved_quantity\+v_item\.qty/);
  assert.match(checkout, /quantity_limit is null or reserved_quantity\+sold_quantity\+v_item\.qty<=quantity_limit/);
  assert.match(checkout, /flash_sale_redemptions/);
});

test("flash sale price is authoritative and tied to the catalog price", () => {
  assert.match(hardening, /product_price_history/);
  assert.match(hardening, /variant_price_history/);
  assert.match(hardening, /preceding 7 days/);
  assert.match(hardening, /flash sale price must be below the authoritative 7-day reference price/);
  assert.match(hardening, /new\.reference_price:=coalesce\(v_reference,v_current\)/);
});

test("flash sale targets cannot overlap and state activation is guarded", () => {
  assert.match(hardening, /elemarket:flash-target/);
  assert.match(hardening, /tstzrange\(os\.starts_at,os\.ends_at,'\[\)'\)/);
  assert.match(hardening, /overlapping flash sale exists for this SKU/);
  assert.match(hardening, /flash sale requires at least one item/);
  assert.match(hardening, /flash sale merchant is not eligible/);
});

test("flash sale reservation is released on unpaid cancellation and consumed on payment", () => {
  assert.match(hardening, /old\.status='payment_pending' and new\.status='cancelled'/);
  assert.match(hardening, /reserved_quantity=greatest\(reserved_quantity-q\.quantity,0\)/);
  assert.match(hardening, /sold_quantity=sold_quantity\+q\.quantity/);
  assert.match(hardening, /status='consumed'/);
});

test("orders cannot contain a coupon and flash sale simultaneously", () => {
  assert.match(hardening, /order cannot combine promotion and flash sale/);
  assert.match(hardening, /create trigger order_discount_exclusivity/);
});
