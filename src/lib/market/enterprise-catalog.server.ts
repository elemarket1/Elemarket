import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { getSql } from "@/lib/db";
import { encryptMerchantSensitiveData, decryptMerchantSensitiveData } from "@/lib/security/merchant-sensitive.server";
import { assertPublicHttpsEndpoint, publicHttpsFetch } from "@/lib/security/ssrf.server";

const fieldMappingSchema = z.object({
  id: z.string().min(1).max(200),
  sku: z.string().min(1).max(200).optional(),
  name: z.string().min(1).max(200),
  description: z.string().max(200).optional(),
  category: z.string().min(1).max(120),
  subcategory: z.string().max(120).optional(),
  brand: z.string().max(120).optional(),
  model: z.string().max(120).optional(),
  price: z.string().min(1).max(200),
  currency: z.string().max(50).optional(),
  stock: z.string().min(1).max(200),
  image: z.string().max(200).optional(),
  warrantyMonths: z.string().max(200).optional(),
});

export type EnterpriseCatalogFieldMapping = z.infer<typeof fieldMappingSchema>;

type EnterpriseCatalogRecord = {
  id: string;
  sku?: string;
  name: string;
  description?: string;
  category: string;
  subcategory?: string;
  brand?: string;
  model?: string;
  price: number;
  currency?: string;
  stock: number;
  image?: string;
  warrantyMonths?: number;
  raw: Record<string, unknown>;
};

type Credentials = { token?: string; apiKey?: string; username?: string; password?: string };

function getPath(value: unknown, path: string): unknown {
  if (!path) return value;
  return path.split(".").reduce<unknown>((current, part) => {
    if (current == null || typeof current !== "object") return undefined;
    if (Array.isArray(current)) return current[Number(part)];
    return (current as Record<string, unknown>)[part];
  }, value);
}

function stringValue(value: unknown, field: string, required = false): string | undefined {
  if (value == null) {
    if (required) throw new Error(`Enterprise catalog field ${field} is missing`);
    return undefined;
  }
  const text = String(value).trim();
  if (!text && required) throw new Error(`Enterprise catalog field ${field} is empty`);
  return text || undefined;
}

function numberValue(value: unknown, field: string, integer = false): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || (integer && !Number.isInteger(n))) throw new Error(`Invalid enterprise catalog ${field}`);
  return n;
}

async function validateEndpoint(endpoint: string): Promise<URL> {
  return assertPublicHttpsEndpoint(endpoint);
}

function normalizeRecord(raw: unknown, mapping: EnterpriseCatalogFieldMapping): EnterpriseCatalogRecord {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Enterprise catalog item must be an object");
  const id = stringValue(getPath(raw, mapping.id), "id", true)!;
  const name = stringValue(getPath(raw, mapping.name), "name", true)!;
  const category = stringValue(getPath(raw, mapping.category), "category", true)!;
  const price = numberValue(getPath(raw, mapping.price), "price");
  if (price <= 0 || price > 100000000) throw new Error(`Invalid enterprise catalog price for ${id}`);
  const stock = numberValue(getPath(raw, mapping.stock), "stock", true);
  if (stock > 1000000) throw new Error(`Invalid enterprise catalog stock for ${id}`);
  const currency = stringValue(mapping.currency ? getPath(raw, mapping.currency) : "GHS", "currency") ?? "GHS";
  if (currency !== "GHS") throw new Error(`Unsupported enterprise catalog currency for ${id}`);
  const warranty = mapping.warrantyMonths ? stringValue(getPath(raw, mapping.warrantyMonths), "warrantyMonths") : undefined;
  return {
    id,
    sku: mapping.sku ? stringValue(getPath(raw, mapping.sku), "sku") : undefined,
    name,
    description: mapping.description ? stringValue(getPath(raw, mapping.description), "description") : undefined,
    category,
    subcategory: mapping.subcategory ? stringValue(getPath(raw, mapping.subcategory), "subcategory") : undefined,
    brand: mapping.brand ? stringValue(getPath(raw, mapping.brand), "brand") : undefined,
    model: mapping.model ? stringValue(getPath(raw, mapping.model), "model") : undefined,
    price,
    currency,
    stock,
    image: mapping.image ? stringValue(getPath(raw, mapping.image), "image") : undefined,
    warrantyMonths: warranty == null ? undefined : numberValue(warranty, "warrantyMonths", true),
    raw: raw as Record<string, unknown>,
  };
}

export async function pinnedGet(url: URL, headers: Headers): Promise<{ status: number; body: string }> {
  const result = await publicHttpsFetch(url, { headers, maxBytes: 10 * 1024 * 1024 });
  return { status: result.status, body: await result.text() };
}

// redirect: "manual"
async function* fetchCatalogPages(connection: {
  endpoint_url: string;
  auth_type: "none" | "bearer" | "api_key" | "basic";
  credentials_encrypted: string | null;
  response_path: string;
  field_mapping: EnterpriseCatalogFieldMapping;
  cursor_param: string;
  cursor_path: string | null;
  page_size: number;
}): AsyncGenerator<{ records: EnterpriseCatalogRecord[]; page: number }, void, void> {
  const baseUrl = await validateEndpoint(connection.endpoint_url);
  const credentials = connection.credentials_encrypted ? decryptMerchantSensitiveData<Credentials>(connection.credentials_encrypted) : {};
  const headers = new Headers({ accept: "application/json" });
  if (connection.auth_type === "bearer") {
    if (!credentials.token) throw new Error("Enterprise catalog bearer token is not configured");
    headers.set("authorization", `Bearer ${credentials.token}`);
  } else if (connection.auth_type === "api_key") {
    if (!credentials.apiKey) throw new Error("Enterprise catalog API key is not configured");
    headers.set("x-api-key", credentials.apiKey);
  } else if (connection.auth_type === "basic") {
    if (!credentials.username || !credentials.password) throw new Error("Enterprise catalog basic credentials are not configured");
    headers.set("authorization", `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64")}`);
  }

  let cursor: string | null = null;
  let page = 0;
  let total = 0;
  const seenCursors = new Set<string>();
  for (;;) {
    const url = new URL(baseUrl.toString());
    url.searchParams.set("limit", String(connection.page_size));
    if (cursor) url.searchParams.set(connection.cursor_param, cursor);
    const response = await pinnedGet(url, headers);
    if (response.status >= 300 && response.status < 400) throw new Error("Enterprise catalog redirects are not allowed");
    if (response.status < 200 || response.status >= 300) throw new Error(`Enterprise catalog API returned HTTP ${response.status}`);
    let payload: unknown;
    try { payload = JSON.parse(response.body); } catch { throw new Error("Enterprise catalog response is not valid JSON"); }
    const items = getPath(payload, connection.response_path);
    if (!Array.isArray(items)) throw new Error("Enterprise catalog response path is not an array");
    const records: EnterpriseCatalogRecord[] = [];
    for (const item of items) {
      if (total >= 50000) throw new Error("Enterprise catalog contains too many products in one sync");
      records.push(normalizeRecord(item, connection.field_mapping));
      total++;
    }
    page += 1;
    yield { records, page };
    if (!connection.cursor_path || items.length === 0) break;
    const next = getPath(payload, connection.cursor_path);
    const nextCursor = next == null ? null : String(next).trim();
    if (!nextCursor || nextCursor === cursor || seenCursors.has(nextCursor)) break;
    seenCursors.add(nextCursor);
    cursor = nextCursor;
    if (page >= 250) throw new Error("Enterprise catalog pagination exceeded the maximum page count");
  }
}

export async function syncEnterpriseCatalog(input: { merchantId: string; source?: "manual" | "scheduled" | "webhook" }) {
  const sql = await getSql();
  const source = input.source ?? "manual";
  const connections = await sql.query<{
    id: string; merchant_id: string; endpoint_url: string; auth_type: "none" | "bearer" | "api_key" | "basic";
    credentials_encrypted: string | null; response_path: string; field_mapping: EnterpriseCatalogFieldMapping;
    sync_mode: "upsert_only" | "snapshot"; status: string; cursor_param: string; cursor_path: string | null; page_size: number;
  }>(`select id,merchant_id,endpoint_url,auth_type,credentials_encrypted,response_path,field_mapping,sync_mode,status,cursor_param,cursor_path,page_size
        from enterprise_catalog_connections where merchant_id=$1`, [input.merchantId]);
  const connection = connections[0];
  if (!connection) throw new Error("Enterprise catalog connection not configured");
  if (connection.status !== "active") throw new Error("Enterprise catalog connection is not active");
  const merchantRows = await sql.query<{ settlement_model: string; catalog_source: string; status: string; verified: boolean }>(
    `select settlement_model,catalog_source,status,verified from merchants where id=$1`, [input.merchantId]);
  const merchant = merchantRows[0];
  if (!merchant || merchant.settlement_model !== "enterprise_direct" || merchant.catalog_source !== "enterprise_api" || merchant.status !== "active" || !merchant.verified) {
    throw new Error("Merchant is not an active verified enterprise API merchant");
  }

  const generationRows = await sql.query<{ generation: string }>(`select nextval('enterprise_catalog_generation_seq')::text as generation`);
  const generation = Number(generationRows[0]?.generation ?? 1);
  const runId = `ecsr_${randomUUID().replaceAll("-", "")}`;
  const lockToken = randomUUID().replaceAll("-", "");
  const claimed = await sql.query<{ id: string }>(`
    update enterprise_catalog_connections
       set sync_lock_token=$2,
           sync_lock_expires_at=now()+interval '5 minutes',
           last_sync_started_at=now(),
           last_sync_error=null,
           updated_at=now()
     where id=$1
       and status='active'
       and (sync_lock_token is null or sync_lock_expires_at < now())
     returning id`, [connection.id, lockToken]);
  if (!claimed[0]) throw new Error("Enterprise catalog sync already in progress");

  await sql.query(`insert into enterprise_catalog_sync_runs(id,connection_id,merchant_id,status,source,generation) values($1,$2,$3,'running',$4,$5)`, [runId, connection.id, input.merchantId, source, generation]);

  try {
    let pages = 0;
    let receivedCount = 0;
    let upserted = 0;
    let errors = 0;
    let lastLeaseRenewalAt = Date.now();
    const configuredWriteBatch = Number(process.env.ELEMARKET_ENTERPRISE_SYNC_WRITE_BATCH_SIZE ?? "100");
    const batchSize = Number.isFinite(configuredWriteBatch)
      ? Math.min(Math.max(Math.trunc(configuredWriteBatch), 25), 500)
      : 100;

    const upsertBatch = async (batch: EnterpriseCatalogRecord[]): Promise<{ upserted: number; errors: number }> => {
      if (!batch.length) return { upserted: 0, errors: 0 };
      const payload = batch.map((record) => {
        const productId = `prod_ext_${createHash("sha256").update(`${input.merchantId}:${record.id}`).digest("hex").slice(0, 40)}`;
        const payloadHash = createHash("sha256").update(JSON.stringify(record.raw)).digest("hex");
        return {
          productId,
          itemId: `eci_${randomUUID().replaceAll("-", "")}`,
          externalProductId: record.id,
          externalSku: record.sku ?? null,
          name: record.name,
          category: record.category,
          subcategory: record.subcategory ?? null,
          brand: record.brand ?? null,
          model: record.model ?? null,
          sku: record.sku ?? record.id,
          attributes: { enterpriseExternalId: record.id, enterprisePayloadHash: payloadHash, image: record.image ?? null },
          warrantyMonths: record.warrantyMonths ?? null,
          price: record.price,
          stock: Math.trunc(record.stock),
          description: record.description ?? "",
          payloadHash,
          raw: record.raw,
        };
      });
      try {
        await sql.query(`
          with input as (select * from jsonb_to_recordset($1::jsonb) as x(
            product_id text, item_id text, external_product_id text, external_sku text, name text, category text,
            subcategory text, brand text, model text, sku text, attributes jsonb, warranty_months integer,
            price numeric, stock integer, description text, payload_hash text, raw jsonb
          ))
          insert into products(
            id,merchant_id,name,category,subcategory,brand,model,sku,condition,attributes,warranty_months,
            fulfillment_type,status,returnable,listing_type,price,currency,stock,description,catalog_source,
            external_product_id,external_sku,external_updated_at,catalog_synced_at,published_at
          )
          select product_id,$2,name,category,subcategory,brand,model,sku,'new',attributes,warranty_months,
                 'delivery','active',true,'product',price,'GHS',stock,description,'enterprise_api',
                 external_product_id,external_sku,now(),now(),coalesce((select p.published_at from products p where p.id=product_id),now())
            from input
          on conflict(id) do update set
            name=excluded.name,category=excluded.category,subcategory=excluded.subcategory,brand=excluded.brand,model=excluded.model,
            sku=excluded.sku,attributes=excluded.attributes,warranty_months=excluded.warranty_months,price=excluded.price,
            currency=excluded.currency,stock=excluded.stock,description=excluded.description,status='active',catalog_source='enterprise_api',
            external_product_id=excluded.external_product_id,external_sku=excluded.external_sku,external_updated_at=now(),catalog_synced_at=now(),updated_at=now();

          insert into enterprise_catalog_items(id,connection_id,merchant_id,external_product_id,external_sku,payload_hash,payload,last_seen_at,last_synced_at,sync_generation,validation_status,validation_error)
          select item_id,$3,$2,external_product_id,external_sku,payload_hash,raw,now(),now(),$4,'valid',null from input
          on conflict(connection_id,external_product_id) do update set
            external_sku=excluded.external_sku,payload_hash=excluded.payload_hash,payload=excluded.payload,last_seen_at=now(),last_synced_at=now(),sync_generation=excluded.sync_generation,validation_status=excluded.validation_status,validation_error=excluded.validation_error;
        `, [JSON.stringify(payload), input.merchantId, connection.id, generation]);
        return { upserted: batch.length, errors: 0 };
      } catch {
        // Isolate a malformed/constraint-breaking record without returning to
        // the old one-SQL-statement-per-record hot path for healthy batches.
        if (batch.length === 1) return { upserted: 0, errors: 1 };
        const midpoint = Math.ceil(batch.length / 2);
        const left = await upsertBatch(batch.slice(0, midpoint));
        const right = await upsertBatch(batch.slice(midpoint));
        return { upserted: left.upserted + right.upserted, errors: left.errors + right.errors };
      }
    };

    for await (const page of fetchCatalogPages(connection)) {
      pages = page.page;
      receivedCount += page.records.length;
      for (let offset = 0; offset < page.records.length; offset += batchSize) {
        if (Date.now() - lastLeaseRenewalAt >= 60_000) {
          const lease = await sql.query<{ id: string }>(`
            update enterprise_catalog_connections
               set sync_lock_expires_at=now()+interval '5 minutes', updated_at=now()
             where id=$1 and sync_lock_token=$2 and sync_lock_expires_at>now()
             returning id`, [connection.id, lockToken]);
          if (!lease[0]) throw new Error("Enterprise catalog sync lease lost");
          lastLeaseRenewalAt = Date.now();
        }
        const result = await upsertBatch(page.records.slice(offset, offset + batchSize));
        upserted += result.upserted;
        errors += result.errors;
      }
    }

    let deactivated = 0;
    if (connection.sync_mode === "snapshot" && errors === 0) {
      const rows = await sql.query<{ count: number }>(`
        with archived as (
          update products p
             set stock=0,status='archived',updated_at=now()
           where p.merchant_id=$1
             and p.catalog_source='enterprise_api'
             and p.external_product_id is not null
             and not exists (
               select 1 from enterprise_catalog_items i
                where i.connection_id=$2
                  and i.external_product_id=p.external_product_id
                  and i.sync_generation = $3
             )
           returning 1
        ) select count(*)::int as count from archived`, [input.merchantId, connection.id, generation]);
      deactivated = Number(rows[0]?.count ?? 0);
    }
    const status = errors ? (upserted ? "partial" : "failed") : "success";
    await sql.query(`update enterprise_catalog_sync_runs set status=$1,completed_at=now(),received_count=$2,upserted_count=$3,deactivated_count=$4,error_count=$5,error_message=$6,cursor_pages=$8,generation=$9 where id=$7`, [status,receivedCount,upserted,deactivated,errors,errors ? `${errors} item(s) failed validation or upsert` : null,runId, pages, generation]);
    await sql.query(`update enterprise_catalog_connections set last_sync_completed_at=now(),last_inventory_sync_at=case when $1='success' then now() else last_inventory_sync_at end,last_sync_status=$1,last_sync_count=$2,last_sync_error=$3,status=$4,sync_lock_token=null,sync_lock_expires_at=null,updated_at=now() where id=$5 and sync_lock_token=$6`, [status,upserted,errors ? `${errors} item(s) failed validation or upsert` : null,status === "failed" ? "error" : "active",connection.id,lockToken]);
    return { runId, status, generation, pages, receivedCount: receivedCount, upsertedCount: upserted, deactivatedCount: deactivated, errorCount: errors };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Enterprise catalog sync failed";
    await sql.query(`update enterprise_catalog_sync_runs set status='failed',completed_at=now(),error_count=1,error_message=$1 where id=$2`, [message.slice(0, 2000),runId]);
    await sql.query(`update enterprise_catalog_connections set last_sync_status='failed',last_sync_error=$1,status='error',sync_lock_token=null,sync_lock_expires_at=null,updated_at=now() where id=$2 and sync_lock_token=$3`, [message.slice(0, 2000),connection.id,lockToken]);
    throw error;
  }
}

export async function saveEnterpriseCatalogConnection(input: {
  merchantId: string;
  endpointUrl: string;
  authType: "none" | "bearer" | "api_key" | "basic";
  credentials?: Credentials;
  responsePath?: string;
  fieldMapping: EnterpriseCatalogFieldMapping;
  syncMode?: "upsert_only" | "snapshot";
  webhookEnabled?: boolean;
  webhookSecret?: string;
  pageSize?: number;
  cursorParam?: string;
  cursorPath?: string;
  inventoryStaleAfterSeconds?: number;
  orderEndpointUrl?: string;
  orderWebhookSecret?: string;
}) {
  await validateEndpoint(input.endpointUrl);
  if (input.orderEndpointUrl) await validateEndpoint(input.orderEndpointUrl);
  const mapping = fieldMappingSchema.parse(input.fieldMapping);
  const sql = await getSql();
  const merchantRows = await sql.query<{ settlement_model: string; catalog_source: string }>(`select settlement_model,catalog_source from merchants where id=$1`, [input.merchantId]);
  if (!merchantRows[0] || merchantRows[0].settlement_model !== "enterprise_direct" || merchantRows[0].catalog_source !== "enterprise_api") throw new Error("Merchant is not configured for enterprise API catalog");

  const existingRows = await sql.query<{
    auth_type: "none" | "bearer" | "api_key" | "basic";
    credentials_encrypted: string | null;
    webhook_enabled: boolean;
    webhook_secret_encrypted: string | null;
    order_webhook_secret_encrypted: string | null;
    order_endpoint_url: string | null;
  }>(`select auth_type,credentials_encrypted,webhook_enabled,webhook_secret_encrypted,order_webhook_secret_encrypted,order_endpoint_url from enterprise_catalog_connections where merchant_id=$1`, [input.merchantId]);
  const existing = existingRows[0];
  const authTypeChanged = Boolean(existing && existing.auth_type !== input.authType);
  if (input.authType !== "none" && authTypeChanged && !input.credentials) {
    throw new Error("New credentials are required when changing enterprise authentication type");
  }
  if (input.authType === "bearer" && input.credentials && !input.credentials.token) throw new Error("Bearer token is required");
  if (input.authType === "api_key" && input.credentials && !input.credentials.apiKey) throw new Error("API key is required");
  if (input.authType === "basic" && input.credentials && (!input.credentials.username || !input.credentials.password)) throw new Error("Basic username and password are required");
  if (input.authType !== "none" && !input.credentials && (!existing || existing.auth_type !== input.authType)) {
    throw new Error("New credentials are required for this authentication mode");
  }
  if (input.webhookEnabled && !input.webhookSecret && (!existing?.webhook_secret_encrypted || !existing.webhook_enabled)) {
    throw new Error("Enterprise catalog webhook secret is required when enabling webhooks");
  }
  if (input.webhookSecret && input.webhookSecret.length < 32) throw new Error("Enterprise catalog webhook secret must be at least 32 characters");
  if (input.orderWebhookSecret && input.orderWebhookSecret.length < 32) throw new Error("Enterprise order webhook secret must be at least 32 characters");

  const id = `ecc_${randomUUID().replaceAll("-", "")}`;
  const encryptedCredentials = input.authType === "none"
    ? null
    : input.credentials
      ? encryptMerchantSensitiveData(input.credentials)
      : existing?.credentials_encrypted ?? null;
  // Never carry credentials across an authentication-mode transition.
  // If the mode changes, the caller must provide credentials for the new mode.
  if (authTypeChanged && input.authType !== "none" && !input.credentials) {
    throw new Error("Authentication mode changed without replacement credentials");
  }
  const encryptedWebhookSecret = input.webhookEnabled
    ? (input.webhookSecret ? encryptMerchantSensitiveData({ secret: input.webhookSecret }) : existing?.webhook_secret_encrypted ?? null)
    : null;
  const encryptedOrderWebhookSecret = input.orderWebhookSecret
    ? encryptMerchantSensitiveData({ secret: input.orderWebhookSecret })
    : existing?.order_webhook_secret_encrypted ?? null;
  const orderEndpointUrl = input.orderEndpointUrl ?? existing?.order_endpoint_url ?? null;
  await sql.query(`
    insert into enterprise_catalog_connections(id,merchant_id,endpoint_url,auth_type,credentials_encrypted,response_path,field_mapping,sync_mode,webhook_enabled,webhook_secret_encrypted,page_size,cursor_param,cursor_path,inventory_stale_after_seconds,order_endpoint_url,order_webhook_secret_encrypted,status,updated_at)
    values($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,$16,'active',now())
    on conflict(merchant_id) do update set endpoint_url=excluded.endpoint_url,auth_type=excluded.auth_type,credentials_encrypted=excluded.credentials_encrypted,response_path=excluded.response_path,field_mapping=excluded.field_mapping,sync_mode=excluded.sync_mode,webhook_enabled=excluded.webhook_enabled,webhook_secret_encrypted=excluded.webhook_secret_encrypted,page_size=excluded.page_size,cursor_param=excluded.cursor_param,cursor_path=excluded.cursor_path,inventory_stale_after_seconds=excluded.inventory_stale_after_seconds,order_endpoint_url=excluded.order_endpoint_url,order_webhook_secret_encrypted=excluded.order_webhook_secret_encrypted,status='active',updated_at=now()
  `, [id,input.merchantId,input.endpointUrl,input.authType,encryptedCredentials,input.responsePath ?? "products",JSON.stringify(mapping),input.syncMode ?? "upsert_only",Boolean(input.webhookEnabled),encryptedWebhookSecret,input.pageSize ?? 250,input.cursorParam ?? "cursor",input.cursorPath ?? null,input.inventoryStaleAfterSeconds ?? 900,orderEndpointUrl,encryptedOrderWebhookSecret]);
  return { configured: true };
}

export async function verifyEnterpriseWebhook(input: { merchantId: string; rawBody: string; signature: string | null }) {
  const sql = await getSql();
  const rows = await sql.query<{ webhook_secret_encrypted: string | null; webhook_enabled: boolean }>(`select webhook_secret_encrypted,webhook_enabled from enterprise_catalog_connections where merchant_id=$1`, [input.merchantId]);
  const row = rows[0];
  if (!row?.webhook_enabled || !row.webhook_secret_encrypted || !input.signature) return false;
  const { secret } = decryptMerchantSensitiveData<{ secret: string }>(row.webhook_secret_encrypted);
  const key = await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(input.rawBody)));
  const provided = input.signature.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(provided)) return false;
  const bytes = Uint8Array.from(provided.match(/.{2}/g)!.map((v) => Number.parseInt(v,16)));
  if (bytes.length !== expected.length) return false;
  let diff = 0; for (let i=0;i<bytes.length;i++) diff |= bytes[i] ^ expected[i];
  return diff === 0;
}

export async function syncAllEnterpriseCatalogs() {
  const sql = await getSql();
  const configuredBatchSize = Number(process.env.ELEMARKET_ENTERPRISE_SYNC_BATCH_SIZE ?? "10");
  const batchSize = Number.isFinite(configuredBatchSize)
    ? Math.min(Math.max(Math.trunc(configuredBatchSize), 1), 25)
    : 10;
  // Process the stalest connections first and bound each serverless invocation.
  // A cron invocation must never attempt to synchronously synchronize every
  // enterprise merchant in the system.
  const rows = await sql.query<{ merchant_id: string }>(
    `select merchant_id
       from enterprise_catalog_connections
      where status='active'
      order by last_sync_started_at asc nulls first, merchant_id asc
      limit $1`,
    [batchSize],
  );
  const results: Array<{ merchantId: string; status: string }> = [];
  for (const row of rows) {
    try {
      const result = await syncEnterpriseCatalog({ merchantId: row.merchant_id, source: "scheduled" });
      results.push({ merchantId: row.merchant_id, status: result.status });
    } catch (error) {
      // Never return upstream/provider/database exception text from this internal
      // control plane. The detailed error is already persisted for operators.
      console.error("[enterprise-catalog-sync] merchant sync failed", {
        merchantId: row.merchant_id,
        error,
      });
      results.push({ merchantId: row.merchant_id, status: "failed" });
    }
  }
  return results;
}
