import { TypesenseSearchProvider } from "./providers/typesense.server";
import type { SearchProvider } from "./search-provider";

export function getSearchProvider(): SearchProvider | null {
  const key = process.env.ELEMARKET_SEARCH_PROVIDER?.trim() || "postgres";
  if (key === "postgres") return null;
  if (key !== "typesense") throw new Error("Selected search provider is unavailable");
  const host = process.env.TYPESENSE_HOST?.trim(), apiKey = process.env.TYPESENSE_SEARCH_KEY?.trim();
  if (!host || !apiKey) throw new Error("Search provider typesense: missing TYPESENSE_HOST/TYPESENSE_SEARCH_KEY");
  return new TypesenseSearchProvider(host, apiKey);
}
