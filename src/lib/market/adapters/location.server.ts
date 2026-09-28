import { createHash } from "node:crypto";
import { getSql } from "@/lib/db";
import { enforceRateLimit } from "@/lib/security/rate-limit.server";
import { getLocationProvider } from "./location-registry.server";
import type { GeocodedLocation } from "./location-provider";
export type { LocationProvider, GeocodedLocation } from "./location-provider";
function normalizeAddress(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function cacheKey(prefix: string, value: string): string {
  return `${prefix}:${createHash("sha256").update(value).digest("hex")}`;
}

async function readCache(key: string): Promise<GeocodedLocation | null> {
  const sql = await getSql();
  const rows = await sql.query<{ latitude: number; longitude: number; formatted_address: string; city: string | null; state: string | null; postcode: string | null; country: string | null; country_code: string | null; confidence: number | null; provider_place_id: string | null }>(
    `select latitude,longitude,formatted_address,city,state,postcode,country,country_code,confidence,provider_place_id
       from geocode_cache where cache_key=$1 and expires_at > now() limit 1`, [key]);
  const row = rows[0];
  if (!row) return null;
  return { latitude: Number(row.latitude), longitude: Number(row.longitude), formattedAddress: row.formatted_address, city: row.city ?? undefined, state: row.state ?? undefined, postcode: row.postcode ?? undefined, country: row.country ?? undefined, countryCode: row.country_code ?? undefined, confidence: row.confidence ?? undefined, providerPlaceId: row.provider_place_id ?? undefined };
}

async function writeCache(key: string, provider: string, location: GeocodedLocation): Promise<void> {
  const sql = await getSql();
  await sql.query(
    `insert into geocode_cache(cache_key,provider,latitude,longitude,formatted_address,city,state,postcode,country,country_code,confidence,provider_place_id,expires_at)
     values($1,$12,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now()+interval '30 days')
     on conflict(cache_key) do update set provider=excluded.provider,latitude=excluded.latitude,longitude=excluded.longitude,formatted_address=excluded.formatted_address,city=excluded.city,state=excluded.state,postcode=excluded.postcode,country=excluded.country,country_code=excluded.country_code,confidence=excluded.confidence,provider_place_id=excluded.provider_place_id,expires_at=excluded.expires_at`,
    [key, location.latitude, location.longitude, location.formattedAddress, location.city ?? null, location.state ?? null, location.postcode ?? null, location.country ?? null, location.countryCode ?? null, location.confidence ?? null, location.providerPlaceId ?? null, provider]);
}

export async function geocodeAddressServer(address: string): Promise<GeocodedLocation> {
  await enforceRateLimit("geocoding-forward", { windowSeconds: 60, maxRequests: 30 });
  const normalized = normalizeAddress(address);
  const provider = getLocationProvider();
  const key = cacheKey(`${provider.key}:forward:gh`, normalized);
  const cached = await readCache(key);
  if (cached) return cached;
  const result = await provider.geocode(address);
  if (result.countryCode && result.countryCode.toLowerCase() !== "gh") throw new Error("Only Ghana delivery locations are supported");
  await writeCache(key, provider.key, result);
  return result;
}

export async function reverseGeocodeServer(lat: number, lon: number): Promise<GeocodedLocation> {
  await enforceRateLimit("geocoding-reverse", { windowSeconds: 60, maxRequests: 30 });
  const rounded = `${lat.toFixed(6)},${lon.toFixed(6)}`;
  const provider = getLocationProvider();
  const key = cacheKey(`${provider.key}:reverse:gh`, rounded);
  const cached = await readCache(key);
  if (cached) return cached;
  const result = await provider.reverseGeocode(lat, lon);
  if (result.countryCode && result.countryCode.toLowerCase() !== "gh") throw new Error("Only Ghana locations are supported");
  await writeCache(key, provider.key, result);
  return result;
}
