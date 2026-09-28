import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd();
const migration=fs.readFileSync(path.join(root,'migrations','0112_cto_high_scale_marketplace_layer.sql'),'utf8');

test('high-scale search has canonical identity and GIN search vector',()=>{
  assert.match(migration,/canonical_product_key/);
  assert.match(migration,/products_search_vector_gin_idx/);
  assert.match(migration,/to_tsvector\('simple'/);
});
test('buy-box is deterministic and explainable',()=>{
  assert.match(migration,/rank_marketplace_offers/);
  assert.match(migration,/modelVersion/);
  assert.match(migration,/price/);
  assert.match(migration,/merchantScore/);
  assert.match(migration,/listingQuality/);
});
test('seller quality is separate from financing health',()=>{
  assert.match(migration,/merchant_service_quality_snapshots/);
  assert.match(migration,/service_band/);
  assert.match(migration,/operational quality only; never a credit score/);
});
test('risk graph stores hashes rather than raw PII',()=>{
  assert.match(migration,/device_hash/);
  assert.match(migration,/address_hash/);
  assert.match(migration,/phone_hash/);
  assert.match(migration,/email_hash/);
  assert.match(migration,/Stable hashes only; no raw customer PII/);
});
test('promotion budget has an atomic row-lock boundary',()=>{
  assert.match(migration,/reserve_promotion_budget/);
  assert.match(migration,/for update/);
  assert.match(migration,/reserved_discount_amount/);
});
test('enterprise API apps support sandbox and production separation',()=>{
  assert.match(migration,/enterprise_api_apps/);
  assert.match(migration,/sandbox/);
  assert.match(migration,/production/);
  assert.match(migration,/api_version/);
});
test('platform has SLO and health-control primitives',()=>{
  assert.match(migration,/platform_slos/);
  assert.match(migration,/platform_slo_measurements/);
  assert.match(migration,/platform_health_checks/);
});
test('live risk functions use provider-neutral dispute and settlement data',()=>{
  assert.doesNotMatch(migration,/from escrow_disputes d join escrows e/);
  assert.match(migration,/from customer_order_disputes d/);
  assert.match(migration,/merchant_provider_funds_summary/);
});
test('search fallback uses ranked full-text relevance with deterministic tie breaks',()=>{
  const search=fs.readFileSync(path.join(root,'src','lib','market','search.server.ts'),'utf8');
  assert.match(search,/websearch_to_tsquery/);
  assert.match(search,/ts_rank_cd/);
  assert.match(search,/p\.stock desc,p\.name asc,p\.id asc/);
});
