import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const migration = fs.readFileSync(path.join(root, "migrations", "0049_adjustable_commission_policy.sql"), "utf8");
const feeFns = fs.readFileSync(path.join(root, "src/routes/admin/fee.functions.ts"), "utf8");
const checkout = fs.readFileSync(path.join(root, "migrations", "0049_adjustable_commission_policy.sql"), "utf8");
const dashboard = fs.readFileSync(path.join(root, "src/routes/admin/dashboard.tsx"), "utf8");

test("commission policy is adjustable and provider-neutral", () => {
  assert.match(migration, /create table if not exists commission_rules/);
  assert.match(migration, /scope_type.*global.*category.*merchant.*product/s);
  assert.match(migration, /get_commission_rate_bps/);
  assert.match(migration, /product.*merchant.*category.*global/s);
  assert.match(feeFns, /requireAdminForUserId/);
  assert.match(feeFns, /requireFreshSession/);
  assert.match(feeFns, /recordAuditEvent/);
});

test("checkout charges commission on product value and keeps delivery outside the commission", () => {
  assert.match(checkout, /v_line_fee := round\(v_line \* v_rate_bps \/ 10000\.0, 2\)/);
  assert.match(checkout, /v_platform_fee := v_platform_fee \+ v_line_fee/);
  assert.match(checkout, /v_product_total - v_platform_fee/);
  assert.match(checkout, /v_product_total \+ v_delivery/);
  assert.match(checkout, /delivery.*never.*part of the platform commission/is);
});

test("historical orders snapshot commission rates", () => {
  assert.match(migration, /create table if not exists order_commission_snapshots/);
  assert.match(migration, /Historical|historical|immutable/i);
  assert.match(checkout, /insert into order_commission_snapshots/);
});

test("provider settlement fees are outside the marketplace ledger", () => {
  assert.match(dashboard, /ELEMARKET marketplace settlement fee: GHS 0\.00/);
});

test("admin UI exposes commission controls", () => {
  assert.match(dashboard, /Commission policy/);
  assert.match(dashboard, /Save override/);
  assert.match(dashboard, /Remove override/);
});
