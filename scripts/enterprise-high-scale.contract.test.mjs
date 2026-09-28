import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../migrations/0087_enterprise_high_scale_integration.sql", import.meta.url), "utf8");
const operationalMigration = await readFile(new URL("../migrations/0088_enterprise_operational_hardening.sql", import.meta.url), "utf8");
const connector = await readFile(new URL("../src/lib/market/enterprise-catalog.server.ts", import.meta.url), "utf8");
const integration = await readFile(new URL("../src/lib/market/enterprise-integration.server.ts", import.meta.url), "utf8");
const webhook = await readFile(new URL("../src/routes/api.enterprise.catalog.webhook.ts", import.meta.url), "utf8");
const dashboard = await readFile(new URL("../src/routes/merchant/dashboard.tsx", import.meta.url), "utf8");
const vercel = await readFile(new URL("../vercel.json", import.meta.url), "utf8");

test("enterprise high-scale migration has durable webhook and order outbox ledgers", () => {
  assert.match(migration, /create table if not exists enterprise_webhook_events/);
  assert.match(migration, /unique index if not exists enterprise_webhook_events_external_uq/);
  assert.match(migration, /create table if not exists enterprise_order_outbox/);
  assert.match(integration, /for update skip locked/);
});

test("enterprise catalogue supports bounded cursor pagination and generations", () => {
  assert.match(migration, /cursor_param text/);
  assert.match(migration, /cursor_path text/);
  assert.match(migration, /sync_generation bigint/);
  assert.match(connector, /page >= 250/);
  assert.match(connector, /total >= 50000/);
  assert.match(connector, /sync_generation/);
});

test("snapshot reconciliation is fail-safe on partial sync", () => {
  assert.match(connector, /connection\.sync_mode === "snapshot" && errors === 0/);
  assert.match(connector, /i\.sync_generation = \$3/);
});

test("enterprise webhooks are signature verified and persisted idempotently", () => {
  assert.match(webhook, /verifyEnterpriseWebhook/);
  assert.match(webhook, /x-event-id/);
  assert.match(integration, /enterprise_webhook_events/);
  assert.match(integration, /claimEnterpriseWebhookEvents/);
  assert.match(integration, /status='processed'/);
});

test("enterprise order delivery is asynchronous and retryable", () => {
  assert.match(migration, /enterprise_order_outbox_on_order/);
  assert.match(integration, /deliverEnterpriseOrderOutbox/);
  assert.match(integration, /status='sent'/);
  assert.match(integration, /retry/);
  assert.match(integration, /dead/);
});

test("enterprise operations expose connection testing and health", () => {
  assert.match(dashboard, /testMerchantEnterpriseConnection/);
  assert.match(dashboard, /Connection health/);
  assert.match(dashboard, /Cursor JSON path/);
  assert.match(dashboard, /Inventory stale threshold/);
});

test("enterprise orders are blocked when inventory freshness expires", () => {
  assert.match(migration, /create or replace function enforce_enterprise_inventory_freshness/);
  assert.match(migration, /enterprise_inventory_freshness_guard/);
  assert.match(migration, /enterprise inventory is stale/);
});

test("enterprise outbox is scheduled separately from catalogue ingestion", () => {
  assert.match(vercel, /api\/internal\/enterprise-order-outbox/);
});


test("enterprise worker claims are crash-recoverable", () => {
  assert.match(operationalMigration, /recover_enterprise_order_outbox_claims/);
  assert.match(operationalMigration, /recover_enterprise_webhook_claims/);
  assert.match(operationalMigration, /locked_at < now\(\) - make_interval/);
});

test("enterprise outbound order delivery supports signed requests and attempt history", () => {
  assert.match(operationalMigration, /enterprise_order_delivery_attempts/);
  assert.match(integration, /x-elemarket-signature/);
  assert.match(integration, /createHmac/);
});

test("enterprise catalogue ingestion is page-streamed rather than retaining the full catalogue in memory", () => {
  assert.match(connector, /async function\* fetchCatalogPages/);
  assert.match(connector, /for await \(const page of fetchCatalogPages/);
  assert.doesNotMatch(connector, /const \{ records, pages \} = await fetchCatalog/);
});

test("enterprise webhook delivery is queued instead of synchronously running a catalogue sync in the public webhook handler", () => {
  assert.match(webhook, /enqueueEnterpriseWebhookEvent/);
  assert.doesNotMatch(webhook, /syncEnterpriseCatalog/);
});
