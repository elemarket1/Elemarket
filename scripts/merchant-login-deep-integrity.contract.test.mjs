import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const tree = fs.readFileSync(new URL("../src/routeTree.gen.ts", import.meta.url), "utf8");
const login = fs.readFileSync(new URL("../src/routes/merchant/login.tsx", import.meta.url), "utf8");
const authz = fs.readFileSync(new URL("../src/lib/auth/authorization.server.ts", import.meta.url), "utf8");
const gates = fs.readFileSync(new URL("../src/lib/auth/gates.tsx", import.meta.url), "utf8");
const review = fs.readFileSync(new URL("../src/routes/admin/merchant-review.functions.ts", import.meta.url), "utf8");
const activation = fs.readFileSync(new URL("../migrations/0054_merchant_application_activation.sql", import.meta.url), "utf8");
const migration = fs.readFileSync(new URL("../migrations/0053_merchant_onboarding_compliance.sql", import.meta.url), "utf8");
const settlementBoundary = fs.readFileSync(new URL("../migrations/0058_marketplace_provider_settlement_boundary.sql", import.meta.url), "utf8");

test("merchant login is a real route and is represented in the generated route tree", () => {
  assert.match(login, /createFileRoute\("\/merchant\/login"\)/);
  assert.match(tree, /Route as MerchantLoginRouteImport/);
  assert.match(tree, /'\/merchant\/login'/);
});

test("customer and merchant contexts remain separate while sharing one identity", () => {
  assert.match(authz, /from merchant_accounts/);
  assert.match(authz, /status='active'/);
  assert.match(login, /getMerchantLoginContext/);
  assert.match(gates, /getMerchantLoginContext/);
  assert.doesNotMatch(gates, /to="\/merchant\/register"/);
});

test("approved merchant applications create an active merchant ownership record", () => {
  assert.match(activation, /create or replace function activate_approved_merchant_application/);
  assert.match(activation, /insert into merchants/);
  assert.match(activation, /insert into merchant_accounts/);
  assert.match(review, /activate_approved_merchant_application/);
});

test("merchant approval uses business address geocoding before activation", () => {
  assert.match(review, /geocodeAddressServer/);
  assert.match(review, /location\.latitude/);
  assert.match(review, /location\.longitude/);
});

test("required merchant compliance fields remain database-enforced without local settlement custody", () => {
  assert.match(migration, /business (?:registration )?number is required/i);
  assert.match(migration, /taxpayer identification is required/i);
  assert.doesNotMatch(settlementBoundary, /settlement details are required/i);
  assert.match(settlementBoundary, /external payment provider/i);
});
