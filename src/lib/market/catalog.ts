import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { CATEGORY_KEYS } from "./categories";
import { haversineKm } from "./money";
import type { JsonObject, MerchantCard, ProductCard, ProductMedia, ProductVariant } from "./types";

const filterSchema = z.object({
  q: z.string().trim().max(80).optional(),
  category: z.enum(CATEGORY_KEYS).optional(),
  subcategory: z.string().trim().max(64).optional(),
  brand: z.string().trim().max(120).optional(),
  listingType: z.enum(["product", "food", "stay"]).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
  radiusKm: z.number().min(3).max(100).optional(),
  merchantId: z.string().max(64).optional(),
  limit: z.number().int().min(1).max(60).optional(),
});

type ProductRow = {
  id: string;
  merchant_id: string;
  merchant_name: string;
  neighborhood: string;
  city: string;
  merchant_address: string;
  name: string;
  category: string;
  subcategory: string | null;
  brand: string | null;
  model: string | null;
  sku: string | null;
  condition: "new" | "refurbished" | "used" | "open_box";
  warranty_months: number | null;
  fulfillment_type: "delivery" | "pickup" | "delivery_and_pickup";
  status: "draft" | "pending_review" | "active" | "suspended" | "archived";
  returnable: boolean;
  return_window_days: number | null;
  attributes: JsonObject;
  financing_eligible: boolean;
  financing_min_amount: string | null;
  financing_max_amount: string | null;
  listing_type: "product" | "food" | "stay";
  price: string;
  stock: number;
  description: string;
  image_path: string | null;
  meal_type: string | null;
  cuisine: string | null;
  prep_minutes: number | null;
  guests: number | null;
  verified: boolean;
  lat: number;
  lon: number;
};

async function getCatalogServerDeps() {
  const [{ getSql }, { enforceRateLimit }] = await Promise.all([
    import("@/lib/db"),
    import("@/lib/security/rate-limit.server"),
  ]);
  return { getSql, enforceRateLimit };
}

function likeSafe(q: string) {
  return q.replace(/[%_\\]/g, "\\$&");
}

function toCard(row: ProductRow, origin?: { lat: number; lon: number }): ProductCard {
  const distanceKm =
    origin != null
      ? Math.round(haversineKm(origin.lat, origin.lon, Number(row.lat), Number(row.lon)) * 10) / 10
      : null;
  return {
    id: row.id,
    merchantId: row.merchant_id,
    merchantName: row.merchant_name,
    neighborhood: row.neighborhood,
    city: row.city,
    name: row.name,
    category: row.category,
    subcategory: row.subcategory,
    brand: row.brand,
    model: row.model,
    sku: row.sku,
    condition: row.condition,
    warrantyMonths: row.warranty_months == null ? null : Number(row.warranty_months),
    fulfillmentType: row.fulfillment_type,
    status: row.status,
    returnable: Boolean(row.returnable),
    returnWindowDays: row.return_window_days == null ? null : Number(row.return_window_days),
    attributes: row.attributes ?? {},
    financingEligible: Boolean(row.financing_eligible),
    financingMinAmount: row.financing_min_amount == null ? null : String(row.financing_min_amount),
    financingMaxAmount: row.financing_max_amount == null ? null : String(row.financing_max_amount),
    listingType: row.listing_type,
    price: String(row.price),
    currency: "GHS",
    stock: Number(row.stock),
    description: row.description,
    imagePath: row.image_path,
    mealType: row.meal_type,
    cuisine: row.cuisine,
    prepMinutes: row.prep_minutes == null ? null : Number(row.prep_minutes),
    guests: row.guests == null ? null : Number(row.guests),
    distanceKm,
    verified: Boolean(row.verified),
    merchantAddress: row.merchant_address,
  };
}

export const listProducts = createServerFn({ method: "GET" })
  .validator(filterSchema)
  .handler(async ({ data }) => {
    const { getSql, enforceRateLimit } = await getCatalogServerDeps();
    await enforceRateLimit("catalog-list-products", { windowSeconds: 60, maxRequests: 120 });
    const sql = await getSql();
    const limit = data.limit ?? 48;
    const q = data.q?.trim();
    const rows = await sql.query<ProductRow>(
      `select p.id, p.merchant_id, m.name as merchant_name, m.neighborhood, m.city, m.address as merchant_address,
              p.name, p.category, p.subcategory, p.brand, p.model, p.sku, p.condition, p.warranty_months, p.fulfillment_type, p.status, p.returnable, p.return_window_days, p.attributes, p.financing_eligible, p.financing_min_amount, p.financing_max_amount, p.listing_type, p.price::text as price, p.stock, p.description, p.image_path,
              p.meal_type, p.cuisine, p.prep_minutes, p.guests, m.verified, m.lat, m.lon
         from products p
         join merchants m on m.id = p.merchant_id
        where m.status = 'active' and m.verified = true and p.status = 'active' and p.stock > 0
          and ($1::text is null or p.category = $1)
          and ($2::text is null or p.subcategory = $2)
          and ($3::text is null or p.listing_type = $3)
          and ($4::text is null or p.merchant_id = $4)
          and ($5::text is null or p.brand ilike $5)
          and ($6::text is null or p.name ilike '%' || $6 || '%' escape '\\' or m.name ilike '%' || $6 || '%' escape '\\')
        order by p.name
        limit $7`,
      [
        data.category ?? null,
        data.subcategory ?? null,
        data.listingType ?? null,
        data.merchantId ?? null,
        data.brand ? `%${likeSafe(data.brand)}%` : null,
        q ? likeSafe(q) : null,
        limit,
      ],
    );
    const origin =
      data.lat != null && data.lon != null ? { lat: data.lat, lon: data.lon } : undefined;
    const radius = data.radiusKm ?? 100;
    return rows
      .map((r) => toCard(r, origin))
      .filter((p) => p.distanceKm == null || p.distanceKm <= radius);
  });

export const getProduct = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string().min(1).max(64) }))
  .handler(async ({ data }) => {
    const { getSql, enforceRateLimit } = await getCatalogServerDeps();
    await enforceRateLimit("catalog-get-product", { windowSeconds: 60, maxRequests: 180 });
    const sql = await getSql();
    const rows = await sql.query<ProductRow>(
      `select p.id, p.merchant_id, m.name as merchant_name, m.neighborhood, m.city, m.address as merchant_address,
              p.name, p.category, p.subcategory, p.brand, p.model, p.sku, p.condition, p.warranty_months, p.fulfillment_type, p.status, p.returnable, p.return_window_days, p.attributes, p.financing_eligible, p.financing_min_amount, p.financing_max_amount, p.listing_type, p.price::text as price, p.stock, p.description, p.image_path,
              p.meal_type, p.cuisine, p.prep_minutes, p.guests, m.verified, m.lat, m.lon
         from products p
         join merchants m on m.id = p.merchant_id
        where p.id = $1 and m.status = 'active' and m.verified = true and p.status = 'active'`,
      [data.id],
    );
    const product = rows[0] ? toCard(rows[0]) : null;
    if (!product) return { product: null, variants: [] as ProductVariant[], media: [] as ProductMedia[], related: [] as ProductCard[] };
    const mediaRows = await sql.query<{
      id: string; product_id: string; kind: ProductMedia["kind"]; storage_key: string;
      alt_text: string | null; sort_order: number; is_primary: boolean;
    }>(
      `select id, product_id, media_type as kind, storage_key, alt_text, sort_order, is_primary
         from product_media
        where product_id = $1 and media_type = 'image'
        order by is_primary desc, sort_order asc, id asc
        limit 12`,
      [product.id],
    );
    const media: ProductMedia[] = mediaRows.map((m) => ({
      id: m.id, productId: m.product_id, kind: m.kind, storageKey: m.storage_key,
      altText: m.alt_text, sortOrder: Number(m.sort_order), isPrimary: Boolean(m.is_primary),
    }));

    const variantRows = await sql.query<{
      id: string; product_id: string; sku: string; name: string | null;
      attributes: JsonObject; price: string; stock: number;
      status: ProductVariant["status"];
    }>(
      `select id, product_id, sku, name, attributes, price::text as price, stock, status
         from product_variants
        where product_id = $1 and status = 'active' and stock > 0
        order by id`,
      [product.id],
    );
    const variants: ProductVariant[] = variantRows.map((v) => ({
      id: v.id, productId: v.product_id, sku: v.sku, name: v.name,
      attributes: v.attributes ?? {}, price: String(v.price), stock: Number(v.stock), status: v.status,
    }));
    const related = await sql.query<ProductRow>(
      `select p.id, p.merchant_id, m.name as merchant_name, m.neighborhood, m.city, m.address as merchant_address,
              p.name, p.category, p.subcategory, p.brand, p.model, p.sku, p.condition, p.warranty_months, p.fulfillment_type, p.status, p.returnable, p.return_window_days, p.attributes, p.financing_eligible, p.financing_min_amount, p.financing_max_amount, p.listing_type, p.price::text as price, p.stock, p.description, p.image_path,
              p.meal_type, p.cuisine, p.prep_minutes, p.guests, m.verified, m.lat, m.lon
         from products p
         join merchants m on m.id = p.merchant_id
        where p.category = $1 and p.id <> $2 and m.status = 'active' and m.verified = true and p.status = 'active' and p.stock > 0
        order by p.name limit 4`,
      [product.category, product.id],
    );
    return { product, variants, media, related: related.map((r) => toCard(r)) };
  });

export const listMerchants = createServerFn({ method: "GET" })
  .validator(
    z.object({
      lat: z.number().min(-90).max(90).optional(),
      lon: z.number().min(-180).max(180).optional(),
      radiusKm: z.number().min(3).max(100).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { getSql, enforceRateLimit } = await getCatalogServerDeps();
    await enforceRateLimit("catalog-list-merchants", { windowSeconds: 60, maxRequests: 120 });
    const sql = await getSql();
    const rows = await sql.query<{
      id: string;
      name: string;
      category: string;
      neighborhood: string;
      city: string;
      address: string;
      description: string;
      tier: string;
      verified: boolean;
      lat: number;
      lon: number;
    }>(
      `select id, name, category, neighborhood, city, address, description, tier, verified, lat, lon
         from merchants
        where status = 'active' and verified = true
        order by name limit 500`,
    );
    const origin =
      data.lat != null && data.lon != null ? { lat: data.lat, lon: data.lon } : null;
    const radius = data.radiusKm ?? 100;
    const merchants: MerchantCard[] = rows.map((r) => {
      const distanceKm = origin
        ? Math.round(haversineKm(origin.lat, origin.lon, Number(r.lat), Number(r.lon)) * 10) / 10
        : null;
      return {
        id: r.id,
        name: r.name,
        category: r.category,
        neighborhood: r.neighborhood,
        city: r.city,
        address: r.address,
        description: r.description,
        tier: r.tier,
        verified: Boolean(r.verified),
        // Do not expose exact merchant coordinates in the public catalogue.
        // Distance is sufficient for discovery; precise coordinates belong in
        // authenticated delivery/dispatch flows.
        lat: null,
        lon: null,
        distanceKm,
      };
    });
    return merchants.filter((m) => m.distanceKm == null || m.distanceKm <= radius);
  });

export const getMerchant = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string().min(1).max(64) }))
  .handler(async ({ data }) => {
    const { getSql, enforceRateLimit } = await getCatalogServerDeps();
    await enforceRateLimit("catalog-get-merchant", { windowSeconds: 60, maxRequests: 180 });
    const sql = await getSql();
    const merchants = await sql.query<{
      id: string;
      name: string;
      category: string;
      neighborhood: string;
      city: string;
      address: string;
      description: string;
      tier: string;
      verified: boolean;
      lat: number;
      lon: number;
    }>(
      `select id, name, category, neighborhood, city, address, description, tier, verified, lat, lon
         from merchants where id = $1 and status = 'active' and verified = true`,
      [data.id],
    );
    const merchant = merchants[0];
    if (!merchant) return { merchant: null, products: [] as ProductCard[] };
    const products = await sql.query<ProductRow>(
      `select p.id, p.merchant_id, m.name as merchant_name, m.neighborhood, m.city, m.address as merchant_address,
              p.name, p.category, p.subcategory, p.brand, p.model, p.sku, p.condition, p.warranty_months, p.fulfillment_type, p.status, p.returnable, p.return_window_days, p.attributes, p.financing_eligible, p.financing_min_amount, p.financing_max_amount, p.listing_type, p.price::text as price, p.stock, p.description, p.image_path,
              p.meal_type, p.cuisine, p.prep_minutes, p.guests, m.verified, m.lat, m.lon
         from products p
         join merchants m on m.id = p.merchant_id
        where p.merchant_id = $1 and p.status = 'active' and p.stock > 0
        order by p.name limit 100`,
      [data.id],
    );
    const card: MerchantCard = {
      id: merchant.id,
      name: merchant.name,
      category: merchant.category,
      neighborhood: merchant.neighborhood,
      city: merchant.city,
      address: merchant.address,
      description: merchant.description,
      tier: merchant.tier,
      verified: Boolean(merchant.verified),
      lat: null,
      lon: null,
      distanceKm: null,
    };
    return { merchant: card, products: products.map((r) => toCard(r)) };
  });

export const resolveProductMerchants = createServerFn({ method: "GET" })
  .validator(z.object({ productIds: z.array(z.string().min(1).max(64)).min(1).max(40) }))
  .handler(async ({ data }) => {
    const { getSql, enforceRateLimit } = await getCatalogServerDeps();
    await enforceRateLimit("catalog-resolve-merchants", { windowSeconds: 60, maxRequests: 120 });
    const sql = await getSql();
    const placeholders = data.productIds.map((_, i) => `$${i + 1}`).join(", ");
    const rows = await sql.query<{ id: string; merchant_id: string }>(
      `select id, merchant_id from products where id in (${placeholders}) and status = 'active'`,
      data.productIds,
    );
    return Object.fromEntries(rows.map((row) => [row.id, row.merchant_id])) as Record<string, string>;
  });
