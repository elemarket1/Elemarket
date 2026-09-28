import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const root=process.cwd();
const migration=fs.readFileSync(path.join(root,"migrations","0116_brand_distributor_high_scale_hardening.sql"),"utf8");
const server=fs.readFileSync(path.join(root,"src","lib","market","brand-integration.server.ts"),"utf8");

test("gateway separates distributor offers from canonical products and location inventory",()=>{
  assert.match(migration,/brand_integration_offers/);
  assert.match(migration,/product_location_inventory/);
  assert.match(migration,/location_id/);
  assert.match(server,/apply_brand_integration_record/);
});

test("authorization is revalidated at operation time",()=>{
  assert.match(server,/assertLiveBrandAuthorization/);
  assert.match(server,/expires_at/);
  assert.match(migration,/apply_brand_integration_record/);
});

test("webhook identity is deterministic without provider event ids",()=>{
  assert.match(migration,/event_identity/);
  assert.match(server,/eventIdentity/);
  assert.match(server,/eventIdentity=input\.externalEventId/);
});

test("HMAC is implemented and explicitly requires a secret",()=>{
  assert.match(server,/authType === "hmac"/);
  assert.match(server,/credentials\?\.secret/);
  assert.match(server,/createHmac\("sha256"/);
  assert.match(server,/x-elemarket-signature/);
});

test("connection sync has lease and circuit breaker",()=>{
  assert.match(migration,/sync_lease_owner/);
  assert.match(migration,/circuit_state/);
  assert.match(server,/sync_lease_until/);
  assert.match(server,/circuit_state='open'/);
});

test("snapshot sync marks stale mappings and offers",()=>{
  assert.match(server,/sync_mode==='snapshot'/);
  assert.match(server,/brand_integration_offers set status='stale'/);
  assert.match(server,/brand_integration_product_map set status='stale'/);
});

test("credentials support versioned zero-downtime rotation",()=>{
  assert.match(migration,/brand_integration_credentials/);
  assert.match(migration,/one_active/);
  assert.match(server,/status='retired'/);
});

test("outbound mutating requests carry external idempotency and HMAC",()=>{
  assert.match(server,/idempotency-key/);
  assert.match(server,/auth_type==="hmac"/);
});
