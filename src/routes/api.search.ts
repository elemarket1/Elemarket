import { createFileRoute } from "@tanstack/react-router";
import { searchProducts } from "@/lib/market/search.server";
import { enforceRateLimit, rateLimitResponse } from "@/lib/security/rate-limit.server";

function boolParam(value: string | null, fallback: boolean) {
  if (value == null) return fallback;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new Error("invalid boolean");
}
function numberParam(value: string | null) {
  if (value == null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error("invalid number");
  return n;
}

export const Route = createFileRoute("/api/search")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          await enforceRateLimit("api-search", { windowSeconds: 60, maxRequests: 120 });
        } catch (error) {
          const limited = rateLimitResponse(error);
          if (limited) return limited;
          throw error;
        }
        const url = new URL(request.url);
        try {
          const q = (url.searchParams.get("q") ?? "").trim().slice(0, 120);
          const requestedLimit = Number(url.searchParams.get("limit") ?? 40);
          const limit = Number.isFinite(requestedLimit)
            ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 60)
            : 40;
          const result = await searchProducts({
            q,
            category: url.searchParams.get("category") ?? undefined,
            subcategory: url.searchParams.get("subcategory") ?? undefined,
            brand: url.searchParams.get("brand") ?? undefined,
            model: url.searchParams.get("model") ?? undefined,
            merchantId: url.searchParams.get("merchantId") ?? undefined,
            listingType: (url.searchParams.get("listingType") as "product" | "food" | "stay" | null) ?? undefined,
            condition: (url.searchParams.get("condition") as "new" | "refurbished" | "used" | "open_box" | null) ?? undefined,
            minPrice: numberParam(url.searchParams.get("minPrice")),
            maxPrice: numberParam(url.searchParams.get("maxPrice")),
            inStock: boolParam(url.searchParams.get("inStock"), true),
            sort: (url.searchParams.get("sort") as "relevance" | "price_asc" | "price_desc" | "newest" | null) ?? "relevance",
            limit,
            cursor: url.searchParams.get("cursor") ?? undefined,
          });
          return Response.json(result, { headers: { "Cache-Control": "private, max-age=15, stale-while-revalidate=30", "X-Search-Version": result.searchVersion } });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Search unavailable";
          if (message.includes("cursor")) return Response.json({ error: message }, { status: 400 });
          return new Response("Search unavailable", { status: 503 });
        }
      },
    },
  },
});
