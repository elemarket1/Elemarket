import type { SearchInput, SearchHit, SearchFacet } from "@/lib/market/search.server";
export interface SearchProvider {
  readonly key: string;
  search(input: SearchInput, query: string, page: number): Promise<{ hits: SearchHit[]; total: number; facets: Record<string, SearchFacet[]> }>;
}
