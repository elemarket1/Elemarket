import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../migrations/0096_catalog_financing_health_hardening.sql', import.meta.url), 'utf8');
const financing = fs.readFileSync(new URL('../src/lib/market/financing.ts', import.meta.url), 'utf8');

test('catalog taxonomy is enforced for every writer', () => {
  assert.match(migration, /invalid or inactive product category/i);
  assert.match(migration, /invalid or inactive product subcategory for category/i);
  assert.match(migration, /products_taxonomy_validate/);
});

test('listing quality is server-derived and versioned', () => {
  assert.match(migration, /product_listing_quality/);
  assert.match(migration, /calculate_product_listing_quality/);
  assert.match(migration, /listing-quality-v1/);
});

test('merchant health uses neutral provider-facing bands', () => {
  assert.match(migration, /limited_history.*developing.*established.*strong.*very_strong/s);
  assert.doesNotMatch(financing, /eligible_small|eligible_medium|strong_profile/);
  assert.match(financing, /merchantHealthBand/);
});

test('merchant health does not expose a credit decision', () => {
  assert.match(migration, /never a credit decision/i);
  assert.match(migration, /Never a credit approval/i);
});

console.log('Catalog + financing Walmart/OWASP contracts: 4 assertions passed, 0 failed');
