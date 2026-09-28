import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getAuthenticatedUserId, authMiddleware } from "@/lib/auth/middleware";
import { requireAdminCapability } from "@/lib/admin/permissions.server";
import { getSql } from "@/lib/db";
import { enforceRateLimit } from "@/lib/security/rate-limit.server";
import type { JsonObject, JsonValue } from "@/lib/db-types";

export type SupportInboxRow = { id: string; customerId: string; orderId: string | null; status: string; updatedAt: string; lastMessage: string | null };
type SupportThreadRow = { id: string; customerId: string; orderId: string | null; status: string; messageId: string | null; senderType: string | null; body: string | null; createdAt: string | null };
type AssistedProductRow = { id: string; name: string; price: string; stock: number; merchantId: string; merchantName: string; variants: JsonValue[] };

// Support replies are persisted through the atomic append_support_agent_message database function with sender_type=support.
const replySchema = z.object({ conversationId: z.string().trim().min(1).max(80), body: z.string().trim().min(1).max(4000), idempotencyKey: z.string().trim().min(16).max(128) });

export const listSupportInbox = createServerFn({ method: "GET" }).middleware([authMiddleware]).validator(z.object({page:z.number().int().min(0).max(10000).default(0),status:z.enum(["active","all","open","waiting_support","waiting_customer","resolved","closed"]).default("active")}).default({page:0,status:"active"})).handler(async ({ context,data }) => {
  const adminId = getAuthenticatedUserId(context);
  await requireAdminCapability("read_support", adminId);
  await enforceRateLimit("admin-support-read", { windowSeconds: 60, maxRequests: 60, subject: adminId });
  const sql = await getSql();
  return sql.query<SupportInboxRow>(`select c.id,c.customer_id as "customerId",c.order_id as "orderId",c.status,c.updated_at as "updatedAt",
      (select left(m.body,240) from support_messages m where m.conversation_id=c.id order by m.created_at desc, m.id desc limit 1) as "lastMessage"
    from support_conversations c where ($1='all' or ($1='active' and c.status in ('open','waiting_support','waiting_customer')) or c.status=$1) order by c.updated_at desc,c.id desc limit 21 offset $2`,[data.status,data.page*20]);
});

export const getSupportThread = createServerFn({ method: "GET" }).middleware([authMiddleware]).validator(z.object({ conversationId: z.string().trim().min(1).max(80) })).handler(async ({ data, context }) => {
  const adminId = getAuthenticatedUserId(context);
  await requireAdminCapability("read_support", adminId);
  await enforceRateLimit("admin-support-thread-read", { windowSeconds: 60, maxRequests: 120, subject: adminId });
  const sql = await getSql();
  await sql.query("select record_audit_event('admin.support.read','support_conversation',$1,$2,'admin',null,'success')", [data.conversationId,adminId]);
  const rows = await sql.query<SupportThreadRow>(`select c.id,c.customer_id as "customerId",c.order_id as "orderId",c.status,
      m.id as "messageId",m.sender_type as "senderType",m.body,m.created_at as "createdAt"
    from support_conversations c left join support_messages m on m.conversation_id=c.id
    where c.id=$1 order by m.created_at asc,m.id asc limit 300`, [data.conversationId]);
  return rows;
});

export const replySupportThread = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator(replySchema).handler(async ({ data, context }) => {
  const adminId = getAuthenticatedUserId(context);
  await requireAdminCapability("write_support", adminId, true);
  await enforceRateLimit("admin-support-reply", { windowSeconds: 60, maxRequests: 60, subject: adminId });
  const sql = await getSql();
  const rows = await sql.query<{ result: JsonValue }>(
    "select append_support_agent_message($1,$2,$3,$4) as result",
    [adminId, data.conversationId, data.body, data.idempotencyKey],
  );
  return rows[0]?.result ?? null;
});

const assistedDraftSchema = z.object({
  conversationId: z.string().trim().min(1).max(80),
  items: z.array(z.object({
    productId: z.string().trim().min(1).max(64),
    variantId: z.string().trim().min(1).max(64).nullable().optional(),
    quantity: z.number().int().min(1).max(20),
  })).min(1).max(40),
});

export const createAssistedOrderDraft = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(assistedDraftSchema)
  .handler(async ({ data, context }) => {
    const adminId = getAuthenticatedUserId(context);
    await requireAdminCapability("write_support", adminId, true);
    await enforceRateLimit("admin-support-assisted-order", { windowSeconds: 60, maxRequests: 20, subject: adminId });
    const sql = await getSql();
    const rows = await sql.query<{ result: JsonObject }>(
      `with identity as (select set_config('app.user_id',$1,true))
       select create_assisted_order_draft($1,$2,$3::jsonb) as result from identity`,
      [adminId, data.conversationId, JSON.stringify(data.items)],
    );
    return rows[0]?.result ?? null;
  });

export const searchProductsForAssistedOrder = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.object({ q: z.string().trim().min(2).max(80) }))
  .handler(async ({ data, context }) => {
    const adminId = getAuthenticatedUserId(context);
    await requireAdminCapability("read_support", adminId);
    await enforceRateLimit("admin-support-assisted-product-search", { windowSeconds: 60, maxRequests: 60, subject: adminId });
    const sql = await getSql();
    return sql.query<AssistedProductRow>(
      `select p.id,p.name,p.price::text as price,p.stock,p.merchant_id as "merchantId",m.name as "merchantName",
              coalesce((select jsonb_agg(jsonb_build_object('id',pv.id,'name',coalesce(pv.name,pv.sku),'price',pv.price::text,'stock',pv.stock) order by pv.id) from product_variants pv where pv.product_id=p.id and pv.status='active' and pv.stock>0),'[]'::jsonb) as variants
         from products p join merchants m on m.id=p.merchant_id
        where m.status='active' and m.verified=true and p.status='active' and p.stock>0
          and (p.name ilike '%'||$1||'%' escape '\\' or coalesce(p.sku,'') ilike '%'||$1||'%' escape '\\')
        order by p.name limit 20`,
      [data.q.replace(/[%_\\]/g, "\\$&")],
    );
  });
