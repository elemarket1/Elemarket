import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd();
const migration=fs.readFileSync(path.join(root,'migrations','0115_brand_distributor_integration_gateway.sql'),'utf8')+"\n"+fs.readFileSync(path.join(root,'migrations','0116_brand_distributor_high_scale_hardening.sql'),'utf8');
const server=fs.readFileSync(path.join(root,'src','lib','market','brand-integration.server.ts'),'utf8');
const dashboard=fs.readFileSync(path.join(root,'src','routes','merchant','dashboard.functions.ts'),'utf8');

test('brand gateway has authorized connection isolation and explicit scopes',()=>{
  assert.match(migration,/brand_integration_connections/);
  assert.match(migration,/authorization_id/);
  assert.match(migration,/validate_brand_integration_connection/);
  assert.match(server,/ALLOWED_SCOPES/);
  assert.match(server,/catalog:read/);
  assert.match(server,/orders:write/);
});

test('brand authorization expiry/revocation disables integrations',()=>{
  assert.match(migration,/revoke_brand_integrations_on_authorization_change/);
  assert.match(migration,/status='revoked'/);
  assert.match(migration,/expires_at/);
});

test('gateway supports REST, CSV, XML and ERP connector modes',()=>{
  assert.match(migration,/rest_json/);
  assert.match(migration,/csv/);
  assert.match(migration,/xml/);
  assert.match(migration,/erp_oms_wms/);
  assert.match(server,/parseBrandFeed/);
  assert.match(server,/DOCTYPE/);
  assert.match(server,/ENTITY/);
});

test('gateway uses encrypted credentials and SSRF validation',()=>{
  assert.match(server,/encryptMerchantSensitiveData/);
  assert.match(server,/decryptMerchantSensitiveData/);
  assert.match(server,/assertPublicHttpsEndpoint/);
});

test('catalog sync has canonical product mapping, version checks and reconciliation',()=>{
  assert.match(migration,/brand_integration_product_map/);
  assert.match(migration,/external_version/);
  assert.match(migration,/brand_integration_reconciliation/);
  assert.match(server,/staleRejected/);
  assert.match(migration,/product_identifiers/);
});

test('order integration is asynchronous and idempotent',()=>{
  assert.match(migration,/brand_integration_order_outbox/);
  assert.match(migration,/unique\(connection_id,idempotency_key\)/);
  assert.match(migration,/brand_integration_order_trigger/);
  assert.match(migration,/orders:write/);
});

test('webhook signing uses constant-time verification',()=>{
  assert.match(server,/createHmac\("sha256"/);
  assert.match(server,/timingSafeEqual/);
});

test('merchant dashboard exposes scoped configuration, credential rotation and health',()=>{
  assert.match(dashboard,/configureBrandDistributorIntegration/);
  assert.match(dashboard,/rotateBrandDistributorIntegrationCredentials/);
  assert.match(dashboard,/loadBrandDistributorIntegrationHealth/);
  assert.match(dashboard,/requireFreshSession/);
});
