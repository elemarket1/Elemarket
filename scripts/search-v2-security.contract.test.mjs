import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd();
const search=fs.readFileSync(path.join(root,'src','lib','market','search.server.ts'),'utf8')+fs.readFileSync(path.join(root,'src','lib','market','adapters','providers','typesense.server.ts'),'utf8');
const route=fs.readFileSync(path.join(root,'src','routes','api.search.ts'),'utf8');
const migration=fs.readFileSync(path.join(root,'migrations','0113_advanced_search_v2.sql'),'utf8')+'\n'+fs.readFileSync(path.join(root,'migrations','0114_cto_release_hardening.sql'),'utf8');

test('search v2 is a unified versioned contract',()=>{
  assert.match(search,/SEARCH_VERSION = "search-v2"/);
  assert.match(search,/SearchResponse/);
  assert.match(route,/searchProducts\(/);
});
test('search v2 supports exact canonical identifiers before fuzzy retrieval',()=>{
  assert.match(search,/product_identifiers/);
  assert.match(search,/identifierExists/);
  assert.match(search,/normalized_value/);
  assert.match(search,/normalized\.identifier/);
});
test('search v2 has signed expiring cursors bound to query/filter/sort',()=>{
  assert.match(search,/createHmac\("sha256"/);
  assert.match(search,/timingSafeEqual/);
  assert.match(search,/CURSOR_TTL_SECONDS/);
  assert.match(search,/cursor\.q !== normalized\.normalized/);
  assert.match(search,/cursor\.filter !== fingerprint/);
});
test('search v2 exposes category-aware facets and analytics/indexing primitives',()=>{
  assert.match(search,/facet_counts/);
  assert.match(search,/jsonb_each_text/);
  assert.match(migration,/marketplace_search_synonyms/);
  assert.match(migration,/marketplace_search_events/);
  assert.match(migration,/marketplace_search_index_jobs/);
});
test('search v2 uses PostgreSQL Unicode normalization form as a keyword',()=>{
  assert.match(migration,/normalize\(coalesce\(p_value,''\),\s*NFKC\)/);
  assert.doesNotMatch(migration,/normalize\(coalesce\(p_value,''\),\s*'NFKC'\)/);
});

test('search v2 has normalized search fields and indexes',()=>{
  assert.match(migration,/normalized_name/);
  assert.match(migration,/normalized_brand/);
  assert.match(migration,/normalized_model/);
  assert.match(migration,/products_search_identifiers_gin_idx/);
  assert.match(migration,/product_identifiers_normalized_lookup_idx/);
});
test('search API clamps malformed limits and supports high-scale filters',()=>{
  assert.match(route,/Number\.isFinite\(requestedLimit\)/);
  assert.match(route,/minPrice/);
  assert.match(route,/maxPrice/);
  assert.match(route,/condition/);
  assert.match(route,/cursor/);
});

test('search v2 keeps Typesense filter/sort/cursor semantics aligned with the public contract',()=>{
  assert.match(search,/subcategory/);
  assert.match(search,/merchantId/);
  assert.match(search,/listing_type/);
  assert.match(search,/condition/);
  assert.match(search,/sort_by/);
  assert.match(search,/backend: provider.key/);
  assert.match(search,/page: providerPage \+ 1/);
  assert.match(search,/appliedFilters: JSON.parse\(fingerprint\)/);
});

test('search analytics do not retain arbitrary normalized query text',()=>{
  assert.match(migration,/drop column if exists query_normalized/);
  assert.match(migration,/keyed application digest|query_hash/i);
});

test('search index jobs coalesce pending work and carry catalog version',()=>{
  assert.match(migration,/catalog_version bigint/);
  assert.match(migration,/marketplace_search_index_jobs_pending_product_uidx/);
  assert.match(migration,/where status='pending'/);
});

test('migration runner serializes deployment migrations with a PostgreSQL advisory lock',()=>{
  const runner=fs.readFileSync(path.join(root,'scripts','migrate.mjs'),'utf8');
  assert.match(runner,/pg_advisory_lock/);
  assert.match(runner,/pg_advisory_unlock/);
});

test('rate limiting has a Redis hot path with PostgreSQL fallback',()=>{
  const rate=fs.readFileSync(path.join(root,'src','lib','security','rate-limit.server.ts'),'utf8');
  assert.match(rate,/REDIS_URL/);
  assert.match(rate,/REDIS_HTTP_TOKEN/);
  assert.match(rate,/EVAL/);
  assert.match(rate,/consume_api_rate_limit/);
});
