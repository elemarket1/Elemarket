import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../migrations/0109_enterprise_multilocation_scale.sql", import.meta.url), "utf8");

test("enterprise has a parent organization and location-scoped RBAC", () => {
  assert.match(migration, /create table if not exists enterprise_organizations/);
  assert.match(migration, /create table if not exists enterprise_location_staff/);
  assert.match(migration, /enterprise_admin/);
  assert.match(migration, /assert_enterprise_location_access/);
});

test("locations support store, warehouse and fulfillment node types", () => {
  assert.match(migration, /location_type text not null default 'warehouse'/);
  assert.match(migration, /distribution_center/);
  assert.match(migration, /fulfillment_center/);
  assert.match(migration, /pickup_point/);
  assert.match(migration, /enterprise_location_capabilities/);
});

test("inventory is location-specific and has an immutable movement ledger", () => {
  assert.match(migration, /enterprise_inventory_ledger/);
  assert.match(migration, /movement_type text not null/);
  assert.match(migration, /unique\(organization_id,idempotency_key\)/);
  assert.match(migration, /validate_enterprise_inventory_location/);
});

test("inventory reservation is atomic and idempotent", () => {
  assert.match(migration, /reserve_enterprise_inventory/);
  assert.match(migration, /for update/);
  assert.match(migration, /insufficient location inventory/);
  assert.match(migration, /p_idempotency_key/);
  assert.match(migration, /release_enterprise_inventory/);
});

test("inter-location transfers are first-class and cannot transfer within one location", () => {
  assert.match(migration, /enterprise_inventory_transfers/);
  assert.match(migration, /from_location_id <> to_location_id/);
  assert.match(migration, /idempotency_key text not null unique/);
});

test("routing and operating constraints are represented", () => {
  assert.match(migration, /enterprise_routing_policies/);
  assert.match(migration, /strategy text not null/);
  assert.match(migration, /enterprise_location_hours/);
});

test("security-definer inventory functions have public execution revoked", () => {
  assert.match(migration, /revoke all on function reserve_enterprise_inventory/);
  assert.match(migration, /revoke all on function release_enterprise_inventory/);
  assert.match(migration, /set search_path=public,pg_temp/);
});
