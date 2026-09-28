import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { enforceRateLimit } from "@/lib/security/rate-limit.server";
import { getAuthenticatedUserId } from "@/lib/auth/middleware";

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

const geocodeSchema = z.object({
  address: z.string().trim().min(3).max(400),
});

const reverseSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});

export const geocodeAddress = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(geocodeSchema)
  .handler(async ({ data, context }) => {
    await enforceRateLimit("geocode-forward", { windowSeconds: 60, maxRequests: 20, subject: getAuthenticatedUserId(context) });
    const { geocodeAddressServer } = await import("@/lib/market/adapters/location.server");
    return geocodeAddressServer(data.address);
  });

export const reverseGeocode = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(reverseSchema)
  .handler(async ({ data, context }) => {
    await enforceRateLimit("geocode-reverse", { windowSeconds: 60, maxRequests: 20, subject: getAuthenticatedUserId(context) });
    const { reverseGeocodeServer } = await import("@/lib/market/adapters/location.server");
    return reverseGeocodeServer(data.lat, data.lon);
  });
