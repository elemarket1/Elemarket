import { createHash } from "node:crypto";
import { z } from "zod";
import { getSql } from "@/lib/db";
import { env } from "@/lib/env.server";
import { readResponseBodyWithLimit } from "@/lib/security/body.server";
import { enforceRateLimit } from "@/lib/security/rate-limit.server";

export type GeocodedLocation = {
  latitude: number;
  longitude: number;
  formattedAddress: string;
  city?: string;
  state?: string;
  postcode?: string;
  country?: string;
  countryCode?: string;
  confidence?: number;
  providerPlaceId?: string;
};

export interface LocationProvider {
  geocode(address: string): Promise<GeocodedLocation>;
  reverseGeocode(lat: number, lon: number): Promise<GeocodedLocation>;
}

const geoapifyResult = z.object({
  lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180),
  formatted: z.string().min(1).max(500),
  city: z.string().max(120).optional(), state: z.string().max(120).optional(),
  postcode: z.string().max(40).optional(), country: z.string().max(120).optional(),
  country_code: z.literal("gh"), rank: z.object({ confidence: z.number().min(0).max(1).optional() }).optional(),
  place_id: z.string().max(256).optional(),
});

const geoapifyResponse = z.object({ results: z.array(geoapifyResult).max(10) });

function normalizeAddress(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function cacheKey(prefix: string, value: string): string {
  return `${prefix}:${createHash("sha256").update(value).digest("hex")}`;
}

function toLocation(properties: z.infer<typeof geoapifyResult>): GeocodedLocation {
  return {
    latitude: properties.lat,
    longitude: properties.lon,
    formattedAddress: properties.formatted,
    city: properties.city,
    state: properties.state,
    postcode: properties.postcode,
    country: properties.country,
    countryCode: properties.country_code,
    confidence: properties.rank?.confidence,
    providerPlaceId: properties.place_id,
  };
}

export class GeoapifyLocationProvider implements LocationProvider {
  constructor(private readonly apiKey: string, private readonly baseUrl = "https://api.geoapify.com/v1") {}

  private async request(url: URL): Promise<GeocodedLocation> {
    const response = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json" },
      redirect: "error", signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`Geoapify returned HTTP ${response.status}`);
    const body = await readResponseBodyWithLimit(response, 512 * 1024);
    let payload: unknown;
    try { payload = JSON.parse(body); } catch { throw new Error("Location provider returned invalid JSON"); }
    const parsed = geoapifyResponse.safeParse(payload);
    if (!parsed.success || parsed.data.results.length === 0) throw new Error("Location could not be found");
    return toLocation(parsed.data.results[0]);
  }

  async geocode(address: string): Promise<GeocodedLocation> {
    if (address.trim().length < 3 || address.length > 500) throw new Error("Invalid delivery address");
    const url = new URL(`${this.baseUrl}/geocode/search`);
    url.searchParams.set("text", address);
    url.searchParams.set("filter", "countrycode:gh");
    url.searchParams.set("limit", "1");
    url.searchParams.set("format", "json");
    url.searchParams.set("apiKey", this.apiKey);
    return this.request(url);
  }

  async reverseGeocode(lat: number, lon: number): Promise<GeocodedLocation> {
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error("Invalid coordinates");
    const url = new URL(`${this.baseUrl}/geocode/reverse`);
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lon));
    url.searchParams.set("format", "json");
    url.searchParams.set("apiKey", this.apiKey);
    return this.request(url);
  }
}

function getLocationProvider(): LocationProvider {
  const provider = (env("ELEMARKET_LOCATION_PROVIDER") || "geoapify").toLowerCase();
  if (provider !== "geoapify") throw new Error(`Unsupported location provider '${provider}'`);
  const apiKey = env("GEOAPIFY_API_KEY");
  if (!apiKey) throw new Error("GEOAPIFY_API_KEY is not configured");
  return new GeoapifyLocationProvider(apiKey);
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

async function writeCache(key: string, location: GeocodedLocation): Promise<void> {
  const sql = await getSql();
  await sql.query(
    `insert into geocode_cache(cache_key,provider,latitude,longitude,formatted_address,city,state,postcode,country,country_code,confidence,provider_place_id,expires_at)
     values($1,'geoapify',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now()+interval '30 days')
     on conflict(cache_key) do update set latitude=excluded.latitude,longitude=excluded.longitude,formatted_address=excluded.formatted_address,city=excluded.city,state=excluded.state,postcode=excluded.postcode,country=excluded.country,country_code=excluded.country_code,confidence=excluded.confidence,provider_place_id=excluded.provider_place_id,expires_at=excluded.expires_at`,
    [key, location.latitude, location.longitude, location.formattedAddress, location.city ?? null, location.state ?? null, location.postcode ?? null, location.country ?? null, location.countryCode ?? null, location.confidence ?? null, location.providerPlaceId ?? null]);
}

export async function geocodeAddressServer(address: string): Promise<GeocodedLocation> {
  await enforceRateLimit("geocoding-forward", { windowSeconds: 60, maxRequests: 30 });
  const normalized = normalizeAddress(address);
  const key = cacheKey("forward:gh", normalized);
  const cached = await readCache(key);
  if (cached) return cached;
  const result = await getLocationProvider().geocode(address);
  if (result.countryCode && result.countryCode.toLowerCase() !== "gh") throw new Error("Only Ghana delivery locations are supported");
  await writeCache(key, result);
  return result;
}

export async function reverseGeocodeServer(lat: number, lon: number): Promise<GeocodedLocation> {
  await enforceRateLimit("geocoding-reverse", { windowSeconds: 60, maxRequests: 30 });
  const rounded = `${lat.toFixed(6)},${lon.toFixed(6)}`;
  const key = cacheKey("reverse:gh", rounded);
  const cached = await readCache(key);
  if (cached) return cached;
  const result = await getLocationProvider().reverseGeocode(lat, lon);
  if (result.countryCode && result.countryCode.toLowerCase() !== "gh") throw new Error("Only Ghana locations are supported");
  await writeCache(key, result);
  return result;
}
