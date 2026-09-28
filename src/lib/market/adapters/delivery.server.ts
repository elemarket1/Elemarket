import { z } from "zod";
import { getSql } from "@/lib/db";
import { isWorkspacePreview } from "@/lib/env.server";
import { requireCustomerForUserId } from "@/lib/auth/authorization.server";
import { enforceRateLimit } from "@/lib/security/rate-limit.server";
import { haversineKm, quoteDelivery, type DeliveryTier } from "@/lib/market/money";

export type DeliveryQuoteInput = { merchantId: string; address: string; lat?: number; lon?: number; tier?: "same_day" | "next_day" | "three_day" };
export type DeliveryQuoteResult = { quoteId: string; price: string; currency: "GHS"; etaMinutes: number; expiresAt: string; tier: "same_day" | "next_day" | "three_day"; providerReference?: string };

export interface DeliveryCarrierAdapter { quote(input: DeliveryQuoteInput): Promise<DeliveryQuoteResult>; }

async function resolveDestination(input: DeliveryQuoteInput): Promise<DeliveryQuoteInput> {
  const { geocodeAddressServer } = await import("@/lib/market/adapters/location.server");
  // Client coordinates are advisory only. Delivery pricing must use a server-geocoded address.
  const location = await geocodeAddressServer(input.address);
  return { ...input, lat: location.latitude, lon: location.longitude };
}

export class JsonHttpDeliveryAdapter implements DeliveryCarrierAdapter {
  constructor(private readonly endpoint: string, private readonly secret: string) {}
  async quote(input: DeliveryQuoteInput): Promise<DeliveryQuoteResult> {
    const response = await fetch(this.endpoint, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${this.secret}` },
      body: JSON.stringify(input), redirect: "error", signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Delivery provider returned HTTP ${response.status}`);
    const schema = z.object({
      quoteId: z.string().min(1).max(256),
      price: z.string().regex(/^\d+(?:\.\d{1,2})?$/),
      currency: z.literal("GHS"),
      etaMinutes: z.number().int().positive().max(60 * 24 * 30),
      expiresAt: z.string().datetime(),
      tier: z.enum(["same_day", "next_day", "three_day"]),
      providerReference: z.string().min(1).max(256).optional(),
    });
    const parsed = schema.safeParse(await response.json());
    if (!parsed.success) throw new Error("Delivery provider response failed validation");
    if (Date.parse(parsed.data.expiresAt) <= Date.now()) throw new Error("Delivery provider returned an expired quote");
    return parsed.data;
  }
}

class PreviewDeliveryAdapter implements DeliveryCarrierAdapter {
  async quote(input: DeliveryQuoteInput): Promise<DeliveryQuoteResult> {
    const sql = await getSql();
    const merchants = await sql.query<{ lat: number; lon: number }>(
      `select lat, lon from merchants where id = $1 and status = 'active'`,
      [input.merchantId],
    );
    const merchant = merchants[0];
    if (!merchant) throw new Error("Merchant is not available for delivery");
    const destLat = input.lat ?? 5.6037;
    const destLon = input.lon ?? -0.187;
    const distanceKm = haversineKm(Number(merchant.lat), Number(merchant.lon), destLat, destLon);
    const tier: DeliveryTier = input.tier ?? "next_day";
    const quoted = quoteDelivery(tier, distanceKm);
    return {
      quoteId: `pq_${crypto.randomUUID()}`,
      price: quoted.price,
      currency: "GHS",
      etaMinutes: quoted.etaMinutes,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      tier,
      providerReference: "preview-delivery",
    };
  }
}

export function getDeliveryAdapter(providerKey: string): DeliveryCarrierAdapter {
  if (providerKey === "preview" || (isWorkspacePreview() && !process.env.ELEMARKET_DELIVERY_PROVIDER)) {
    return new PreviewDeliveryAdapter();
  }
  const normalized = providerKey.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const endpoint = process.env[`ELEMARKET_DELIVERY_${normalized}_ENDPOINT`]?.trim();
  const secret = process.env[`ELEMARKET_DELIVERY_${normalized}_SECRET`]?.trim();
  if (!endpoint || !secret) {
    if (isWorkspacePreview()) return new PreviewDeliveryAdapter();
    throw new Error("Delivery provider endpoint/credentials are not configured");
  }
  return new JsonHttpDeliveryAdapter(endpoint, secret);
}


export async function requestDeliveryQuoteServer(input: { data: DeliveryQuoteInput; userId: string }) {

    await enforceRateLimit("delivery-quote", { windowSeconds: 60, maxRequests: 30, subject: input.userId });
    const principal = await requireCustomerForUserId(input.userId);
    const providerKey = process.env.ELEMARKET_DELIVERY_PROVIDER?.trim() || (isWorkspacePreview() ? "preview" : "");
    if (!providerKey) throw new Error("Delivery provider is not configured");
    const adapter = getDeliveryAdapter(providerKey);
    const data = await resolveDestination(input.data);
    const quote = await adapter.quote(data);
    const sql = await getSql();
    const quoteId = `dq_${crypto.randomUUID()}`;
    const fingerprint = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify({ ...data, userId: principal.userId })));
    const fingerprintHex = Array.from(new Uint8Array(fingerprint), (b) => b.toString(16).padStart(2, "0")).join("");
    await sql.query(
      `insert into delivery_quotes(id,user_id,merchant_id,fingerprint,tier,price,eta_minutes,distance_km,dest_address,dest_lat,dest_lon,expires_at)
       values($1,$2,$3,$4,$5,$6,coalesce($7,0),0,$8,$9,$10,$11)`,
      [quoteId, principal.userId, data.merchantId, fingerprintHex, quote.tier, quote.price, quote.etaMinutes, data.address, data.lat ?? null, data.lon ?? null, quote.expiresAt],
    );
    return { ...quote, id: quoteId, providerKey, latitude: data.lat, longitude: data.lon };
}
