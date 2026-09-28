import { z } from "zod";
import { publicHttpsFetch } from "@/lib/security/ssrf.server";
import type { SearchInput, SearchHit, SearchFacet } from "@/lib/market/search.server";
import type { SearchProvider } from "../search-provider";

export class TypesenseSearchProvider implements SearchProvider {
  readonly key = "typesense";
  constructor(private readonly host: string, private readonly apiKey: string) {}
  async search(input: SearchInput, query: string, page: number) {
    const host = this.host, key = this.apiKey;
  const url = new URL("/collections/products/documents/search", host.endsWith("/") ? host : `${host}/`);
  url.searchParams.set("q", query || "*");
  url.searchParams.set("query_by", "name,brand,model,sku,canonical_product_key,merchantName,category,subcategory,description,search_aliases,search_identifiers");
  url.searchParams.set("query_by_weights", "8,7,7,8,9,3,4,4,2,5,9");
  url.searchParams.set("per_page", String(input.limit));
  url.searchParams.set("page", String(Math.max(1, page)));
  url.searchParams.set("facet_by", "category,subcategory,brand,condition,listing_type,currency");
  url.searchParams.set("max_facet_values", "50");
  if (input.sort === "relevance") url.searchParams.set("sort_by", "_text_match:desc,id:asc");
  if (input.sort === "price_asc") url.searchParams.set("sort_by", "price:asc,id:asc");
  if (input.sort === "price_desc") url.searchParams.set("sort_by", "price:desc,id:asc");
  if (input.sort === "newest") url.searchParams.set("sort_by", "created_at:desc,id:asc");

  const filters: string[] = [];
  const exact = (field: string, value: string) => {
    if (/[\\`]/.test(value)) throw new Error("Unsupported search filter literal");
    return `${field}:=\`${value}\``;
  };
  if (input.category) filters.push(exact("category", input.category));
  if (input.subcategory) filters.push(exact("subcategory", input.subcategory));
  if (input.brand) filters.push(exact("brand", input.brand));
  if (input.model) filters.push(exact("model", input.model));
  if (input.merchantId) filters.push(exact("merchantId", input.merchantId));
  if (input.listingType) filters.push(exact("listing_type", input.listingType));
  if (input.condition) filters.push(exact("condition", input.condition));
  if (input.minPrice != null) filters.push(`price:>=${input.minPrice}`);
  if (input.maxPrice != null) filters.push(`price:<=${input.maxPrice}`);
  if (input.inStock) filters.push("stock:>0");
  if (filters.length) url.searchParams.set("filter_by", filters.join(" && "));

  const response = await publicHttpsFetch(url, { headers: { "X-TYPESENSE-API-KEY": key }, redirect: "error", signal: AbortSignal.timeout(3_000) });
  if (!response.ok) throw new Error(`Search backend returned HTTP ${response.status}`);
  const body = await response.json() as { found?: number; page?: number; hits?: unknown[]; facet_counts?: Array<{ field_name?: string; counts?: Array<{ value?: string; count?: number }> }> };
  const hits: SearchHit[] = (body.hits ?? []).flatMap((hit) => {
    if (!hit || typeof hit !== "object") return [];
    const raw = ((hit as { document?: unknown }).document ?? {}) as Record<string, unknown>;
    const parsedHit = z.object({ id: z.string().min(1).max(128), name: z.string().min(1).max(300), merchantName: z.string().max(300).default(""), merchantId: z.string().max(128).optional(), category: z.string().max(120), subcategory: z.string().max(120).nullable().optional(), brand: z.string().max(120).nullable().optional(), model: z.string().max(120).nullable().optional(), sku: z.string().max(128).nullable().optional(), price: z.union([z.string(), z.number()]), currency: z.string().length(3).default("GHS"), stock: z.number().optional(), imagePath: z.string().max(1024).nullable().optional(), condition: z.string().optional() }).safeParse(raw);
    return parsedHit.success ? [{ ...parsedHit.data, price: String(parsedHit.data.price), imagePath: parsedHit.data.imagePath ?? null }] : [];
  });
  const facets: Record<string, SearchFacet[]> = {};
  for (const facet of body.facet_counts ?? []) facets[facet.field_name ?? "unknown"] = (facet.counts ?? []).slice(0, 50).flatMap((c) => c.value != null && c.count != null ? [{ value: c.value, count: c.count }] : []);
    return { hits, total: Number(body.found ?? hits.length), facets };
  }
}
