import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const server = fs.readFileSync(path.join(root,"src/lib/market/brand-integration.server.ts"),"utf8");
const webhook = fs.readFileSync(path.join(root,"src/routes/api.brand.integration.webhook.ts"),"utf8");
const worker = fs.readFileSync(path.join(root,"src/routes/api.internal.brand-integration-worker.ts"),"utf8");
const ssrf = fs.readFileSync(path.join(root,"src/lib/security/ssrf.server.ts"),"utf8");
const migration = fs.readFileSync(path.join(root,"migrations/0117_owasp_deep_remediation.sql"),"utf8");
const gatewayMigrations = migration + fs.readFileSync(path.join(root,"migrations/0116_brand_distributor_high_scale_hardening.sql"),"utf8") + fs.readFileSync(path.join(root,"migrations/0115_brand_distributor_integration_gateway.sql"),"utf8");

test("authorization is rechecked before webhook enqueue, feed mutation and queued order delivery",()=>{
  assert.match(server,/assertLiveBrandAuthorization\(sql,input\.connectionId\)/);
  assert.match(server,/assertLiveBrandAuthorization\(sql,item\.connection_id\)/);
  assert.match(migration,/assert_brand_integration_authorized/);
});

test("credential rotation is single-active and preserves unspecified secret material",()=>{
  assert.match(migration,/brand_integration_credentials_one_active_uq/);
  assert.match(server,/const current = await loadBrandIntegrationCredentials/);
  assert.match(server,/const webhookSecret = input\.webhookSecret \?\? current\.webhookSecret/);
});

test("webhooks have explicit event allowlisting, deterministic identity and optional timestamp replay protection",()=>{
  assert.match(server,/ALLOWED_WEBHOOK_EVENTS/);
  assert.match(server,/deterministicIdentity/);
  assert.match(server,/signBrandWebhookV2/);
  assert.match(server,/Math\.abs\(Date\.now\(\) - millis\) > 5 \* 60 \* 1000/);
  assert.match(gatewayMigrations,/brand_integration_webhook_identity_uq/);
});

test("webhook per-connection throttling occurs only after signature verification",()=>{
  assert.match(webhook,/verifyStoredBrandWebhook\(connectionId,rawBody,signature,timestamp\)/);
  const verifyIndex=webhook.indexOf("verifyStoredBrandWebhook");
  const perKeyIndex=webhook.indexOf("brand-integration-webhook:${connectionId}");
  assert.ok(verifyIndex>=0 && perKeyIndex>verifyIndex);
});

test("webhook workers use crash-recoverable locked claims",()=>{
  assert.match(migration,/recover_brand_integration_processing_claims/);
  assert.match(server,/locked_token=gen_random_uuid\(\)::text/);
  assert.match(server,/where id=\$1 and locked_token=\$2/);
});

test("feeds are bounded against CSV/XML/JSON resource exhaustion",()=>{
  assert.match(server,/MAX_FEED_RECORDS = 10_000/);
  assert.match(server,/MAX_CSV_FIELD_BYTES/);
  assert.match(server,/MAX_CSV_ROW_BYTES/);
  assert.match(server,/MAX_JSON_DEPTH/);
  assert.match(server,/parseBoundedXml/);
  assert.match(server,/DOCTYPE|ENTITY/);
});

test("money and inventory inputs have explicit upper bounds and finite integer stock",()=>{
  assert.match(server,/parseMoney/);
  assert.match(server,/MAX_PRICE_GHS = 100_000_000/);
  assert.match(server,/MAX_STOCK = 1_000_000/);
  assert.match(migration,/brand_integration_offer_price_cap_check/);
  assert.match(migration,/brand_integration_offer_stock_cap_check/);
});

test("field mappings and external attributes are constrained",()=>{
  assert.match(server,/validateFieldMapping/);
  assert.match(server,/MAX_ATTRIBUTES_BYTES/);
  assert.match(migration,/brand_integration_field_mapping_size_check/);
  assert.match(migration,/brand_integration_webhook_payload_size_check/);
});

test("snapshot deactivation is fail-closed and records authoritative snapshot state",()=>{
  assert.match(server,/authoritativeSnapshot/);
  assert.match(server,/Incomplete snapshot cannot deactivate existing catalogue records/);
  assert.match(migration,/authoritative_snapshot boolean/);
});

test("stale imported products are removed from active marketplace state",()=>{
  assert.match(server,/status='inactive',stock=0/);
  assert.match(migration,/brand_integration_offers_fresh_active_idx/);
});

test("queued order delivery is merchant/order scoped and externally idempotent",()=>{
  assert.match(server,/c\.merchant_id !== item\.merchant_id/);
  assert.match(server,/orderRows\[0\]\?\.merchant_id !== item\.merchant_id/);
  assert.match(server,/idempotency-key/);
  assert.match(gatewayMigrations,/unique\(connection_id,idempotency_key\)/);
});

test("outbound integration failures are redacted and retried with jitter",()=>{
  assert.match(server,/\[redacted\]/);
  assert.match(server,/floor\(random\(\)\*10\)/);
  assert.match(server,/publicHttpsFetch/);
  assert.match(ssrf,/Outbound response exceeds size limit/);
});

test("brand worker uses the shared replay-protected authentication boundary",()=>{
  assert.match(worker,/authorizeInternalHmacRequest\(\s*request,\s*process\.env\.ELEMARKET_ENTERPRISE_SYNC_SECRET/);
  assert.doesNotMatch(worker,/function authorized|x-elemarket-sync-secret/);
});

test("SSRF boundary rejects credentials/private targets and pins DNS",()=>{
  assert.match(ssrf,/url\.username \|\| url\.password/);
  assert.match(ssrf,/isPrivateOrReservedIp/);
  assert.match(server,/pinnedPost/);
  assert.match(server,/publicHttpsFetch/);
  assert.match(ssrf,/lookup:/);
});

test("offer ownership is enforced at the database boundary",()=>{
  assert.match(migration,/validate_brand_integration_offer_ownership/);
  assert.match(migration,/brand_integration_offer_ownership_guard/);
});

test("queue recovery and authorization functions are not public",()=>{
  assert.match(migration,/revoke all on function recover_brand_integration_processing_claims/);
  assert.match(migration,/revoke all on function assert_brand_integration_authorized/);
});

test("purchasing and search fail closed for stale enterprise-backed products",()=>{
  const checkoutGuard=fs.readFileSync(path.join(root,"migrations/0117_owasp_deep_remediation.sql"),"utf8");
  const search=fs.readFileSync(path.join(root,"src/lib/market/search.server.ts"),"utf8");
  assert.match(checkoutGuard,/fresh_brand_product_order_item_guard/);
  assert.match(checkoutGuard,/integration product inventory is stale or unavailable/);
  assert.match(search,/hasStaleIntegrationProducts/);
  assert.match(search,/catalog_source <> 'enterprise_api'/);
});
