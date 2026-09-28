import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware, getAuthenticatedUserId } from "@/lib/auth/middleware";
import { requireCustomerForUserId } from "@/lib/auth/authorization.server";
import { getSql } from "@/lib/db";
import { enforceRateLimit } from "@/lib/security/rate-limit.server";

const conversationInput = z.object({ orderId: z.string().trim().min(1).max(64).nullable().optional() });
const messageInput = z.object({ conversationId: z.string().trim().min(1).max(80), body: z.string().trim().min(1).max(4000), idempotencyKey: z.string().trim().min(16).max(128) });

export const getSupportConversation = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(conversationInput)
  .handler(async ({ data, context }) => {
    const userId = getAuthenticatedUserId(context);
    await requireCustomerForUserId(userId);
    await enforceRateLimit("support-conversation-read", { windowSeconds: 60, maxRequests: 30, subject: userId });
    const sql = await getSql();
    const rows = await sql.query<{ id: string }>("select create_support_conversation($1,$2) as id", [userId, data.orderId ?? null]);
    const id = rows[0]?.id;
    if (!id) throw new Error("Support conversation unavailable");
    const messages = await sql.query<{ id: string; senderType: string; body: string; createdAt: string }>(
      `select id, sender_type as "senderType", body, created_at as "createdAt"
         from support_messages where conversation_id=$1 order by created_at desc, id desc limit 200`, [id]);
    messages.reverse();
    const draftRows = await sql.query<{ result: unknown }>(
      `select get_assisted_order_draft($1,d.id) as result
         from support_order_drafts d
        where d.conversation_id=$2 and d.customer_id=$1 and d.status='pending' and d.expires_at>now()
        order by d.updated_at desc limit 1`, [userId, id]);
    return { id, messages, draft: draftRows[0]?.result ?? null };
  });

export const sendSupportMessage = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(messageInput)
  .handler(async ({ data, context }) => {
    const userId = getAuthenticatedUserId(context);
    await requireCustomerForUserId(userId);
    await enforceRateLimit("support-message-send", { windowSeconds: 60, maxRequests: 20, subject: userId });
    const sql = await getSql();
    const rows = await sql.query<{ result: unknown }>(
      "select append_customer_support_message($1,$2,$3,$4) as result",
      [userId, data.conversationId, data.body, data.idempotencyKey],
    );
    return rows[0]?.result ?? null;
  });

export const getAssistedOrderDraft = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.object({ draftId: z.string().trim().min(1).max(80) }))
  .handler(async ({ data, context }) => {
    const userId = getAuthenticatedUserId(context);
    await requireCustomerForUserId(userId);
    await enforceRateLimit("support-assisted-draft-read", { windowSeconds: 60, maxRequests: 30, subject: userId });
    const sql = await getSql();
    const rows = await sql.query<{ result: unknown }>("select get_assisted_order_draft($1,$2) as result", [userId, data.draftId]);
    return rows[0]?.result ?? null;
  });
