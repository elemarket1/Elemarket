import fs from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../migrations/0062_enterprise_catalog_direct_settlement.sql", import.meta.url), "utf8");
const connector = await readFile(new URL("../src/lib/market/enterprise-catalog.server.ts", import.meta.url), "utf8");
const payment = await readFile(new URL("../src/lib/market/payment.server.ts", import.meta.url), "utf8");
const dashboard = await readFile(new URL("../src/routes/merchant/dashboard.tsx", import.meta.url), "utf8");

 test("enterprise merchants have explicit direct-settlement and external-catalog modes", () => {
  assert.match(migration, /settlement_model text not null default 'marketplace_escrow'/);
  assert.match(migration, /enterprise_direct/);
  assert.match(migration, /catalog_source text not null default 'native'/);
  assert.match(migration, /enterprise_api/);
});

test("enterprise payment completion bypasses ELEMARKET escrow", () => {
  assert.match(migration, /if v_order\.settlement_model='enterprise_direct' then/);
  assert.match(migration, /'payment\.enterprise_direct\.completed'/);
  assert.match(migration, /'escrowCreated',false/);
});

test("enterprise merchants cannot request marketplace escrow release", () => {
  assert.match(migration, /if v_model <> 'marketplace_escrow' then/);
  assert.match(migration, /enterprise-direct merchants do not use ELEMARKET escrow release requests/);
});

test("enterprise catalog credentials are encrypted server-side", () => {
  assert.match(connector, /encryptMerchantSensitiveData/);
  assert.match(connector, /decryptMerchantSensitiveData/);
  assert.match(connector, /credentials_encrypted/);
});

test("enterprise catalog connector enforces HTTPS and blocks obvious private endpoints", () => {
  assert.match(connector, /assertPublicHttpsEndpoint/);
  const ssrf = fs.readFileSync("src/lib/security/ssrf.server.ts", "utf8");
  assert.match(ssrf, /localhost/);
  assert.match(ssrf, /192\.0\.0\.0/);
  assert.match(ssrf, /169\.254\.0\.0/);
});

test("enterprise catalog sync writes external identity and stock", () => {
  assert.match(migration, /products_enterprise_external_id_uq/);
  assert.match(connector, /external_product_id/);
  assert.match(connector, /catalog_synced_at/);
  assert.match(connector, /on conflict\(id\) do update/);
});

test("enterprise payment still uses provider merchant subaccount", () => {
  assert.match(payment, /merchantSubaccount:subaccountRows\[0\]\?\.provider_account_ref/);
});

test("merchant UI exposes enterprise API and hides escrow release UI", () => {
  assert.match(dashboard, /m\.catalogSource!=="enterprise_api"/);
  assert.match(dashboard, /Enterprise connection/);
  assert.match(dashboard, /ELEMARKET does not hold, release, or pay out customer funds/);
});

test("enterprise mode is an explicit audited admin operation", () => {
  assert.match(migration, /admin_set_merchant_enterprise_mode/);
  assert.match(migration, /admin\.merchant\.enterprise_enabled/);
  assert.match(migration, /admin\.merchant\.enterprise_disabled/);
});

test("enterprise catalog has a protected scheduled-sync entry point", async () => {
  const route = await readFile(new URL("../src/routes/api.enterprise.catalog.sync.ts", import.meta.url), "utf8");
  assert.match(route, /ELEMARKET_ENTERPRISE_SYNC_SECRET/);
  assert.match(route, /syncAllEnterpriseCatalogs/);
});


test("scheduled enterprise sync is bounded and does not return upstream error text", () => {
  assert.match(connector, /ELEMARKET_ENTERPRISE_SYNC_BATCH_SIZE/);
  assert.match(connector, /limit \$1/);
  assert.match(connector, /last_sync_started_at asc nulls first/);
  assert.match(connector, /results: Array<\{ merchantId: string; status: string \}>/);
  assert.match(connector, /console\.error\("\[enterprise-catalog-sync\] merchant sync failed"/);
});
