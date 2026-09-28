import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const migration = fs.readFileSync(`${root}/migrations/0110_enterprise_operating_system.sql`, "utf8");
const server = fs.readFileSync(`${root}/src/lib/market/enterprise-multilocation.server.ts`, "utf8");
const routes = fs.readFileSync(`${root}/src/routes/merchant/enterprise-locations.functions.ts`, "utf8");

test("enterprise operating system has serialized electronics and service-center primitives", () => {
  assert.match(migration, /create table if not exists enterprise_serial_units/);
  assert.match(migration, /imei text/);
  assert.match(migration, /warranty_expires_at/);
  assert.match(migration, /create table if not exists enterprise_service_cases/);
  assert.match(migration, /service_center/);
});

test("enterprise operating system has split fulfillment and deterministic routing records", () => {
  assert.match(migration, /create table if not exists enterprise_fulfillment_allocations/);
  assert.match(migration, /create table if not exists enterprise_routing_decisions/);
  assert.match(migration, /decision_hash/);
});

test("enterprise operating system has ERP POS WMS sync lifecycle", () => {
  assert.match(migration, /integration_type text not null check \(integration_type in \('erp','pos','wms'/);
  assert.match(migration, /create table if not exists enterprise_sync_runs/);
  assert.match(migration, /create table if not exists enterprise_sync_events/);
  assert.match(migration, /unique\(integration_id,idempotency_key\)/);
});

test("inventory transfer completion is atomic and auditable", () => {
  assert.match(migration, /create or replace function receive_enterprise_inventory_transfer/);
  assert.match(migration, /for update/);
  assert.match(migration, /transfer_out/);
  assert.match(migration, /transfer_in/);
  assert.match(migration, /record_audit_event\('enterprise.inventory.transfer_received'/);
});

test("service cases enforce customer/order and enterprise boundaries", () => {
  assert.match(migration, /validate_enterprise_service_case/);
  assert.match(migration, /service case customer\/order mismatch/);
  assert.match(migration, /service case product organization mismatch/);
});

test("server exposes secure transfer receive and service case paths", () => {
  assert.match(server, /receiveEnterpriseInventoryTransfer/);
  assert.match(server, /createEnterpriseServiceCase/);
  assert.match(routes, /receiveEnterpriseInventoryTransferFn/);
});
