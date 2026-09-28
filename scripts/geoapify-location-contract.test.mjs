import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('src/lib/market/adapters/location.server.ts','utf8');
const adapter = fs.readFileSync('src/lib/market/adapters/providers/geoapify.server.ts','utf8');
const registry = fs.readFileSync('src/lib/market/adapters/location-registry.server.ts','utf8');
const contract = fs.readFileSync('src/lib/market/adapters/location-provider.ts','utf8');
const client = fs.readFileSync('src/lib/market/adapters/location.ts','utf8');
const migration = fs.readFileSync('migrations/0052_geoapify_location_cache.sql','utf8');
const delivery = fs.readFileSync('src/lib/market/adapters/delivery.server.ts','utf8');
const checkout = fs.readFileSync('src/routes/checkout.tsx','utf8');

test('Geoapify location adapter is provider-neutral and server-side', () => {
  assert.match(contract, /export interface LocationProvider/);
  assert.match(adapter, /class GeoapifyLocationProvider/);
  assert.match(registry, /GEOAPIFY_API_KEY/);
  assert.doesNotMatch(client, /GEOAPIFY_API_KEY/);
});

test('Geoapify is Ghana constrained and protected by timeout/validation', () => {
  assert.match(adapter, /filter.*countrycode:gh/);
  assert.match(adapter, /AbortSignal\.timeout\(8_000\)/);
  assert.match(server, /Only Ghana/);
  assert.match(adapter, /safeParse/);
});

test('Location results are cached for quota protection', () => {
  assert.match(migration, /create table if not exists geocode_cache/);
  assert.match(server, /from geocode_cache/);
  assert.match(server, /interval '30 days'/);
});

test('Delivery resolves coordinates when checkout only supplies an address', () => {
  assert.match(delivery, /resolveDestination/);
  assert.match(delivery, /geocodeAddressServer/);
  assert.match(delivery, /latitude: data\.lat/);
  assert.match(delivery, /longitude: data\.lon/);
});

test('Checkout includes required Geoapify attribution', () => {
  assert.match(checkout, /attribution.data/);
  assert.match(adapter, /Geoapify.*OpenStreetMap/);
});
