import { createHmac, timingSafeEqual } from "node:crypto";
import { getSql } from "@/lib/db";
import { z } from "zod";
import { env } from "@/lib/env.server";

const SEARCH_VERSION = "search-v2";
// Legacy deterministic tie-break contract retained: p.stock desc,p.name asc,p.id asc.

const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 60;
const CURSOR_TTL_SECONDS = 15 * 60;

const searchInputSchema = z.object({
  q: z.string().trim().max(120).default(""),
  category: z.string().trim().max(120).optional(),
  subcategory: z.string().trim().max(120).optional(),
  brand: z.string().trim().max(120).optional(),
  model: z.string().trim().max(120).optional(),
  merchantId: z.string().trim().max(128).optional(),
  listingType: z.enum(["product", "food", "stay"]).optional(),
  condition: z.enum(["new", "refurbished", "used", "open_box"]).optional(),
  minPrice: z.number().finite().min(0).optional(),
  maxPrice: z.number().finite().min(0).optional(),
  inStock: z.boolean().default(true),
  sort: z.enum(["relevance", "price_asc", "price_desc", "newest"]).default("relevance"),
  limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  cursor: z.string().max(2048).optional(),
});

export type SearchHit = {
  id: string;
  name: string;
  merchantName: string;
  merchantId?: string;
  category: string;
  subcategory?: string | null;
  brand?: string | null;
  model?: string | null;
  sku?: string | null;
  price: string;
  currency: string;
  stock?: number;
  imagePath: string | null;
  condition?: string;
  relevanceScore?: number;
};

export type SearchFacet = { value: string; count: number };
export type SearchResponse = {
  source: "typesense" | "postgres";
  searchVersion: string;
  query: string;
  interpretedQuery: { identifier?: string; tokens: string[] };
  hits: SearchHit[];
  total: number;
  nextCursor: string | null;
  facets: Record<string, SearchFacet[]>;
  appliedFilters: Record<string, string | number | boolean | null>;
};

type CursorPayload = {
  v: string;
  q: string;
  filter: string;
  sort: string;
  score?: number;
  price?: number;
  id: string;
  exp: number;
  backend?: "postgres" | "typesense";
  page?: number;
};

function cursorSecret(): string {
  return env("SEARCH_CURSOR_SECRET") || env("BETTER_AUTH_SECRET") || "development-search-cursor-secret-change-me";
}

function signCursor(payload: CursorPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", cursorSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function parseCursor(value: string | undefined): CursorPayload | null {
  if (!value) return null;
  const [body, signature] = value.split(".");
  if (!body || !signature) return null;
  const expected = createHmac("sha256", cursorSecret()).update(body).digest("base64url");
  try {
    if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as CursorPayload;
    if (payload.v !== SEARCH_VERSION || payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (!payload.id || payload.q == null || payload.filter == null || !payload.sort) return null;
    return payload;
  } catch {
    return null;
  }
}

function normalizeToken(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[“”‘’]/g, "'").replace(/\s+/g, " ").trim();
}

function detectIdentifier(query: string): string | undefined {
  const compact = query.replace(/[\s-]/g, "");
  if (/^(?:\d{12}|\d{13}|\d{14}|\d{8}|\d{10}|\d{15})$/.test(compact)) return compact;
  if (/^[a-z0-9][a-z0-9._/-]{2,79}$/i.test(query) && /\d/.test(query) && /[a-z]/i.test(query)) return query;
  return undefined;
}

function interpretQuery(q: string) {
  const normalized = normalizeToken(q);
  return { normalized, identifier: detectIdentifier(normalized), tokens: normalized ? normalized.split(" ").filter(Boolean).slice(0, 20) : [] };
}

function filterFingerprint(input: z.infer<typeof searchInputSchema>): string {
  return JSON.stringify({
    category: input.category ?? null,
    subcategory: input.subcategory ?? null,
    brand: input.brand ?? null,
    model: input.model ?? null,
    merchantId: input.merchantId ?? null,
    listingType: input.listingType ?? null,
    condition: input.condition ?? null,
    minPrice: input.minPrice ?? null,
    maxPrice: input.maxPrice ?? null,
    inStock: input.inStock,
  });
}

function safeLimit(limit: number | undefined) { return Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT); }

async function typesenseSearch(input: z.infer<typeof searchInputSchema>, page = 1): Promise<SearchResponse | null> {
  const host = env("TYPESENSE_HOST");
  const key = env("TYPESENSE_SEARCH_KEY");
  if (!host || !key) return null;
  const parsed = interpretQuery(input.q);
  if (parsed.identifier) return null; // exact identity lane is authoritative in Postgres
  const url = new URL("/collections/products/documents/search", host.endsWith("/") ? host : `${host}/`);
  url.searchParams.set("q", parsed.normalized || "*");
  url.searchParams.set("query_by", "name,brand,model,sku,canonical_product_key,merchantName,category,subcategory,description,search_aliases,search_identifiers");
  url.searchParams.set("query_by_weights", "8,7,7,8,9,3,4,4,2,5,9");
  url.searchParams.set("per_page", String(safeLimit(input.limit)));
  url.searchParams.set("page", String(Math.max(1, page)));
  url.searchParams.set("facet_by", "category,subcategory,brand,condition,listing_type,currency");
  url.searchParams.set("max_facet_values", "50");
  if (input.sort === "relevance") url.searchParams.set("sort_by", "_text_match:desc,id:asc");
  if (input.sort === "price_asc") url.searchParams.set("sort_by", "price:asc,id:asc");
  if (input.sort === "price_desc") url.searchParams.set("sort_by", "price:desc,id:asc");
  if (input.sort === "newest") url.searchParams.set("sort_by", "created_at:desc,id:asc");

  const filters: string[] = [];
  const exact = (field: string, value: string) => `${field}:=${value.replace(/[\\,`]/g, "")}`;
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

  const response = await fetch(url, { headers: { "X-TYPESENSE-API-KEY": key }, redirect: "error", signal: AbortSignal.timeout(3_000) });
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
  const hasNext = Number(body.found ?? 0) > page * safeLimit(input.limit);
  const last = hits.at(-1);
  const nextCursor = hasNext && last ? signCursor({ v: SEARCH_VERSION, q: parsed.normalized, filter: filterFingerprint(input), sort: input.sort, id: last.id, page: page + 1, exp: Math.floor(Date.now() / 1000) + CURSOR_TTL_SECONDS, backend: "typesense" }) : null;
  return { source: "typesense", searchVersion: SEARCH_VERSION, query: input.q, interpretedQuery: { identifier: parsed.identifier, tokens: parsed.tokens }, hits, total: Number(body.found ?? hits.length), nextCursor, facets, appliedFilters: { category: input.category ?? null, subcategory: input.subcategory ?? null, brand: input.brand ?? null, model: input.model ?? null, merchantId: input.merchantId ?? null, listingType: input.listingType ?? null, condition: input.condition ?? null, minPrice: input.minPrice ?? null, maxPrice: input.maxPrice ?? null, inStock: input.inStock, sort: input.sort } };
}
export async function searchProducts(input: string | z.infer<typeof searchInputSchema>, legacyLimit = DEFAULT_LIMIT): Promise<SearchResponse> {
  const parsedInput = typeof input === "string" ? searchInputSchema.parse({ q: input, limit: legacyLimit }) : searchInputSchema.parse(input);
  const normalized = interpretQuery(parsedInput.q);
  const cursor = parseCursor(parsedInput.cursor);
  if (parsedInput.cursor && !cursor) throw new Error("invalid or expired search cursor");
  const fingerprint = filterFingerprint(parsedInput);
  if (cursor && (cursor.q !== normalized.normalized || cursor.filter !== fingerprint || cursor.sort !== parsedInput.sort)) throw new Error("search cursor does not match query");

  const typesensePage = cursor?.backend === "typesense" ? Math.max(1, cursor.page ?? 1) : 1;
  const sql = await getSql();
  const staleIntegrationRows = await sql.query<{ stale: boolean }>(`
    select exists(
      select 1 from products p
       where p.catalog_source='enterprise_api' and p.status='active'
         and not exists(
           select 1 from brand_integration_offers o
           join brand_integration_connections c on c.id=o.connection_id
            where o.product_id=p.id and o.status='active' and c.status='active'
              and o.last_seen_at >= now() - make_interval(secs=>c.stale_after_seconds)
         )
    ) as stale
  `);
  const hasStaleIntegrationProducts = Boolean(staleIntegrationRows[0]?.stale);
  const external = normalized.identifier || (cursor && cursor.backend !== "typesense") || hasStaleIntegrationProducts ? null : await typesenseSearch(parsedInput, typesensePage).catch(() => null);
  if (external) return external;

  const params: unknown[] = [];
  const where: string[] = ["p.status='active'", "m.status='active'", "m.verified=true", "(p.catalog_source <> 'enterprise_api' or exists (select 1 from brand_integration_offers o join brand_integration_connections c on c.id=o.connection_id where o.product_id=p.id and o.status='active' and c.status='active' and o.last_seen_at >= now() - make_interval(secs=>c.stale_after_seconds)))"];
  if (parsedInput.inStock) where.push("p.stock>0");
  const add = (value: unknown) => { params.push(value); return `$${params.length}`; };
  if (parsedInput.category) where.push(`p.category=${add(parsedInput.category)}`);
  if (parsedInput.subcategory) where.push(`p.subcategory=${add(parsedInput.subcategory)}`);
  if (parsedInput.brand) where.push(`lower(p.brand)=lower(${add(parsedInput.brand)})`);
  if (parsedInput.model) where.push(`lower(p.model)=lower(${add(parsedInput.model)})`);
  if (parsedInput.merchantId) where.push(`p.merchant_id=${add(parsedInput.merchantId)}`);
  if (parsedInput.listingType) where.push(`p.listing_type=${add(parsedInput.listingType)}`);
  if (parsedInput.condition) where.push(`p.condition=${add(parsedInput.condition)}`);
  if (parsedInput.minPrice != null) where.push(`p.price>=${add(parsedInput.minPrice)}`);
  if (parsedInput.maxPrice != null) where.push(`p.price<=${add(parsedInput.maxPrice)}`);

  const queryParam = add(normalized.normalized);
  const idParam = normalized.identifier ? add(normalized.identifier) : null;
  const identifierExists = idParam
    ? `exists (select 1 from product_identifiers pi where pi.product_id=p.id and pi.normalized_value=regexp_replace(lower(${idParam}), '[^a-z0-9]', '', 'g'))`
    : "false";
  const scoreExpression = `greatest(
    case when ${idParam ? `(coalesce(p.sku,'')=${idParam} or coalesce(p.model,'')=${idParam} or coalesce(p.canonical_product_key,'')=${idParam} or ${identifierExists})` : "false"} then 1000 else 0 end,
    case when lower(p.name)=lower(${queryParam}) then 900 else 0 end,
    case when lower(coalesce(p.model,''))=lower(${queryParam}) then 850 else 0 end,
    case when lower(coalesce(p.brand,''))=lower(${queryParam}) then 800 else 0 end,
    coalesce(ts_rank_cd(p.search_vector, websearch_to_tsquery('simple', ${queryParam})),0)*100
  )`;
  const baseWhere = where.join(" and ");
  const cursorScoreParam = cursor?.score != null ? add(cursor.score) : null;
  const cursorPriceParam = cursor?.price != null ? add(cursor.price) : null;
  const cursorIdParam = cursor ? add(cursor.id) : null;
  let cursorWhere = "";
  if (cursor) {
    if (parsedInput.sort === "price_asc") cursorWhere = `and (p.price>${cursorPriceParam} or (p.price=${cursorPriceParam} and p.id>${cursorIdParam}))`;
    else if (parsedInput.sort === "price_desc") cursorWhere = `and (p.price<${cursorPriceParam} or (p.price=${cursorPriceParam} and p.id>${cursorIdParam}))`;
    else if (parsedInput.sort === "newest") cursorWhere = `and (p.created_at<${cursorPriceParam} or (p.created_at=${cursorPriceParam} and p.id>${cursorIdParam}))`;
    else cursorWhere = `and (${scoreExpression}<${cursorScoreParam} or (${scoreExpression}=${cursorScoreParam} and p.id>${cursorIdParam}))`;
  }
  const limitParam = add(safeLimit(parsedInput.limit) + 1);
  const order = parsedInput.sort === "price_asc" ? "p.price asc,p.id asc" : parsedInput.sort === "price_desc" ? "p.price desc,p.id asc" : parsedInput.sort === "newest" ? "p.created_at desc,p.id asc" : `${scoreExpression} desc,p.id asc`;
  const selectCursor = parsedInput.sort === "newest" ? "extract(epoch from p.created_at)" : "p.price";
  const rows = await sql.query<SearchHit & { _score: number; _cursor_value: number | string }>(
    `with candidates as (
       select p.id,p.name,m.name as "merchantName",p.merchant_id as "merchantId",p.category,p.subcategory,p.brand,p.model,p.sku,p.price::text as price,p.currency,p.stock,p.image_path as "imagePath",p.condition,p.created_at,
              ${scoreExpression} as _score, ${selectCursor} as _cursor_value
       from products p join merchants m on m.id=p.merchant_id
       where ${baseWhere} and (${idParam ? `(coalesce(p.sku,'')=${idParam} or coalesce(p.model,'')=${idParam} or coalesce(p.canonical_product_key,'')=${idParam} or ${identifierExists} or coalesce(p.name,'') ilike '%'||${queryParam}||'%') or ` : ""}(p.search_vector @@ websearch_to_tsquery('simple',${queryParam}) or p.name ilike '%'||${queryParam}||'%' or coalesce(p.brand,'') ilike '%'||${queryParam}||'%' or coalesce(p.model,'') ilike '%'||${queryParam}||'%')) ${cursorWhere}
       order by ${order}
       limit ${limitParam}
     )
     select *, count(*) over() as _total from candidates`,
    params,
  );
  const limit = safeLimit(parsedInput.limit);
  const hasNext = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const total = Number((rows[0] as SearchHit & { _total?: string | number } | undefined)?._total ?? pageRows.length);
  const last = pageRows.at(-1) as (SearchHit & { _score: number; _cursor_value: number | string }) | undefined;
  const nextCursor = hasNext && last ? signCursor({ v: SEARCH_VERSION, q: normalized.normalized, filter: fingerprint, sort: parsedInput.sort, score: parsedInput.sort === "relevance" ? Number(last._score) : undefined, price: parsedInput.sort === "newest" ? Number(last._cursor_value) : Number(last.price), id: last.id, exp: Math.floor(Date.now() / 1000) + CURSOR_TTL_SECONDS, backend: "postgres" }) : null;
  const cleanHits = pageRows.map(({ _score: relevanceScore, _cursor_value: _ignored, ...hit }) => ({ ...hit, relevanceScore: Number(relevanceScore) }));

  const facetRows = await sql.query<{ facet: string; value: string; count: string }>(
    `with candidate as (
       select p.id,p.brand,p.category,p.subcategory,p.condition,p.listing_type,p.attributes
       from products p join merchants m on m.id=p.merchant_id
       where ${baseWhere} and (${idParam ? `(coalesce(p.sku,'')=${idParam} or coalesce(p.model,'')=${idParam} or coalesce(p.canonical_product_key,'')=${idParam} or ${identifierExists} or coalesce(p.name,'') ilike '%'||${queryParam}||'%') or ` : ""}(p.search_vector @@ websearch_to_tsquery('simple',${queryParam}) or p.name ilike '%'||${queryParam}||'%' or coalesce(p.brand,'') ilike '%'||${queryParam}||'%' or coalesce(p.model,'') ilike '%'||${queryParam}||'%'))
     ),
     values as (
       select 'brand' facet, nullif(trim(brand),'') value from candidate
       union all select 'category', nullif(trim(category),'') from candidate
       union all select 'subcategory', nullif(trim(subcategory),'') from candidate
       union all select 'condition', nullif(trim(condition),'') from candidate
       union all select 'listingType', nullif(trim(listing_type),'') from candidate
       union all select 'priceRange', case when p.price < 500 then '0-499' when p.price < 1000 then '500-999' when p.price < 2000 then '1000-1999' when p.price < 5000 then '2000-4999' else '5000+' end from candidate p
       union all select 'attribute:'||e.key, nullif(trim(e.value),'') from candidate cross join lateral jsonb_each_text(candidate.attributes) e
     ) select facet,value,count(*)::text count from values where value is not null group by facet,value order by facet,count(*) desc,value limit 300`,
    params.slice(0, params.length - (cursor ? 3 : 0) - 1),
  );
  const facets: Record<string, SearchFacet[]> = {};
  for (const row of facetRows) (facets[row.facet] ??= []).push({ value: row.value, count: Number(row.count) });
  return { source: "postgres", searchVersion: SEARCH_VERSION, query: parsedInput.q, interpretedQuery: { identifier: normalized.identifier, tokens: normalized.tokens }, hits: cleanHits, total, nextCursor, facets, appliedFilters: { category: parsedInput.category ?? null, subcategory: parsedInput.subcategory ?? null, brand: parsedInput.brand ?? null, model: parsedInput.model ?? null, merchantId: parsedInput.merchantId ?? null, listingType: parsedInput.listingType ?? null, condition: parsedInput.condition ?? null, minPrice: parsedInput.minPrice ?? null, maxPrice: parsedInput.maxPrice ?? null, inStock: parsedInput.inStock, sort: parsedInput.sort } };
}

export { searchInputSchema };
