import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware, getAuthenticatedUserId } from "@/lib/auth/middleware";
import { requireAdminCapability } from "./permissions.server";
import { getSql } from "@/lib/db";
import { enforceRateLimit } from "@/lib/security/rate-limit.server";
import { pageInput, supportActionInput, threadInput, type SafeRow } from "./orders.schemas";

export const readAdminSupportConversation = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(threadInput)
  .handler(async ({ context, data }) => {
    const actor = getAuthenticatedUserId(context);
    await requireAdminCapability("read_support", actor);
    await enforceRateLimit("admin-support-detail", {
      subject: actor,
      windowSeconds: 60,
      maxRequests: 100,
    });
    const sql = await getSql();
    const threads = await sql.query<SafeRow>(
      `select c.id,c.order_id as "orderId",c.customer_id as "customerId",u.name as customer,c.subject,c.category,c.status,c.assigned_to as "assignedTo",a.name as assignee,c.escalated_at::text as "escalatedAt",c.resolved_at::text as "resolvedAt",c.created_at::text as "createdAt",c.updated_at::text as "updatedAt" from support_conversations c join "user" u on u.id=c.customer_id left join "user" a on a.id=c.assigned_to where c.id=$1 and c.order_id is not distinct from $2::text`,
      [data.conversationId, data.orderId],
    );
    if (!threads[0]) throw new Error("Conversation unavailable");
    const messages = await sql.query<SafeRow>(
      `select * from (select id,'message'::text as kind,sender_type as "senderType",sender_id as "senderId",body,created_at::text as "createdAt" from support_messages where conversation_id=$1 union all select id,'internal_note','staff',author_id,body,created_at::text from support_staff_notes where conversation_id=$1) thread order by "createdAt" desc,id desc limit $2 offset $3`,
      [data.conversationId, data.pageSize + 1, data.page * data.pageSize],
    );
    await sql.query(
      "select record_audit_event('admin.support.read','support_conversation',$1,$2,'admin',null,'success')",
      [data.conversationId, actor],
    );
    return {
      conversation: threads[0],
      messages: messages.slice(0, data.pageSize).reverse(),
      hasMore: messages.length > data.pageSize,
    };
  });
export const manageAdminSupport = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(supportActionInput)
  .handler(async ({ context, data }) => {
    const actor = getAuthenticatedUserId(context);
    await requireAdminCapability("write_support", actor, true);
    await enforceRateLimit("admin-support-operation", {
      subject: actor,
      windowSeconds: 60,
      maxRequests: 40,
    });
    const { orderId, conversationId, action, idempotencyKey, ...values } = data;
    if (action === "open" && (!orderId || conversationId))
      throw new Error("Select an order to open support");
    if (action !== "open" && !conversationId) throw new Error("Select a conversation");
    const sql = await getSql();
    const rows = await sql.query<{
      result: { conversationId: string; orderId: string | null; action: string };
    }>(
      `with identity as (select set_config('app.user_id',$1,true)) select manage_admin_support($1,$2,$3,$4,$5::jsonb,$6) result from identity`,
      [actor, orderId, conversationId, action, JSON.stringify(values), idempotencyKey],
    );
    return rows[0].result;
  });
export const listAdminSupportStaff = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.object({ ...pageInput }).strict())
  .handler(async ({ context, data }) => {
    const actor = getAuthenticatedUserId(context);
    await requireAdminCapability("write_support", actor);
    await enforceRateLimit("admin-support-staff", {
      subject: actor,
      windowSeconds: 60,
      maxRequests: 40,
    });
    const sql = await getSql();
    const rows = await sql.query<{ id: string; name: string }>(
      `select id,name from "user" where role='admin' order by name,id limit $1 offset $2`,
      [data.pageSize + 1, data.page * data.pageSize],
    );
    return { rows: rows.slice(0, data.pageSize), hasMore: rows.length > data.pageSize };
  });
