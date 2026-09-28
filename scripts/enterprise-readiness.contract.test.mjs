import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const root = process.cwd();
const migration = fs.readFileSync(`${root}/migrations/0108_enterprise_brand_fulfillment_readiness.sql`, "utf8");
const productSchema = fs.readFileSync(`${root}/migrations/0002_marketplace.sql`, "utf8");
const enterprise = fs.readFileSync(`${root}/migrations/0087_enterprise_high_scale_integration.sql`, "utf8");

test("enterprise product identity supports canonical retail identifiers", () => {
  assert.match(migration, /create table if not exists product_identifiers/);
  assert.match(migration, /gtin12/);
  assert.match(migration, /gtin13/);
  assert.match(migration, /gtin14/);
  assert.match(migration, /upc/);
  assert.match(migration, /ean/);
  assert.match(migration, /mpn/);
  assert.match(migration, /imei/);
  assert.match(migration, /serial/);
  assert.match(migration, /product_identifiers_global_uq/);
});

test("brand authorization is enforced at the database boundary", () => {
  assert.match(migration, /enforce_product_brand_authorization/);
  assert.match(migration, /merchant_brand_authorizations/);
  assert.match(migration, /status='verified'/);
  assert.match(migration, /product_brand_authorization_guard/);
});

test("inventory is ready for multi-location enterprise operations", () => {
  assert.match(migration, /merchant_inventory_locations/);
  assert.match(migration, /product_location_inventory/);
  assert.match(migration, /inventory location does not belong to product merchant/);
  assert.match(enterprise, /inventory_stale_after_seconds/);
});

test("orders support partial shipments and shipment event history", () => {
  assert.match(migration, /create table if not exists shipments/);
  assert.match(migration, /create table if not exists shipment_items/);
  assert.match(migration, /shipment quantity exceeds ordered quantity/);
  assert.match(migration, /create table if not exists shipment_events/);
});

test("enterprise partner API access is scoped and revocable", () => {
  assert.match(migration, /enterprise_api_clients/);
  assert.match(migration, /client_secret_hash/);
  assert.match(migration, /scopes text\[\]/);
  assert.match(migration, /assert_enterprise_api_scope/);
  assert.match(migration, /status='active'/);
  assert.match(migration, /expires_at/);
});

test("marketplace reconciliation is a first-class operational control", () => {
  assert.match(migration, /marketplace_reconciliation_cases/);
  assert.match(migration, /case_type text not null/);
  assert.match(migration, /payment/);
  assert.match(migration, /refund/);
  assert.match(migration, /inventory/);
  assert.match(migration, /shipment/);
  assert.match(migration, /catalog/);
  assert.match(migration, /settlement/);
});

test("legacy checkout remains server authoritative", () => {
  assert.match(productSchema, /Atomic paid checkout/);
  assert.match(productSchema, /Prices, stock and delivery fees are server-authoritative/);
});
