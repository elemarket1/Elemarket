import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware, getAuthenticatedUserId } from "@/lib/auth/middleware";

const itemSchema = z.object({
  productId: z.string().min(1).max(64),
  variantId: z.string().min(1).max(64).nullable(),
  quantity: z.number().int().min(1).max(20),
});

const quoteSchema = z.object({
  merchantId: z.string().min(1).max(64),
  quoteId: z.string().min(1).max(64),
});

const pendingCheckoutSchema = z.object({
  idempotencyKey: z.string().min(16).max(128),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  items: z.array(itemSchema).min(1).max(40),
  quotes: z.array(quoteSchema).min(1).max(40),
  address: z.string().trim().min(8).max(400),
  method: z.enum(["mobile_money", "card", "bank_transfer"]),
  promoCode: z.string().trim().max(64).regex(/^[A-Za-z0-9_-]{4,64}$/).nullable().optional(),
  assistedDraftId: z.string().trim().min(1).max(80).nullable().optional(),
});

export type PendingCheckoutInput = z.infer<typeof pendingCheckoutSchema>;

export async function createPendingCheckoutServer(data: PendingCheckoutInput, userId: string) {
  const [{ getSql }, { requireCustomerForUserId }, { enforceRateLimit }] = await Promise.all([
    import("@/lib/db"),
    import("@/lib/auth/authorization.server"),
    import("@/lib/security/rate-limit.server"),
  ]);
  await requireCustomerForUserId(userId);
  await enforceRateLimit("checkout-create", { windowSeconds: 60, maxRequests: 8, subject: userId });
  const sql = await getSql();
  // Set the verified session identity and invoke the DB transaction in one SQL
  // statement/connection. The client never controls app.user_id.
  const rows = await sql.query<{ result: unknown }>(
    `with identity as (select set_config('app.user_id', $1, true) as user_id)
     select create_pending_order($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8) as result
     from identity, (select set_config('app.assisted_draft_id', coalesce($9, ''), true)) draft`,
    [
      userId,
      data.idempotencyKey,
      data.fingerprint,
      JSON.stringify(data.items),
      JSON.stringify(data.quotes),
      data.address,
      data.method,
      data.promoCode ?? null,
      data.assistedDraftId ?? null,
    ],
  );
  return rows[0]?.result ?? null;
}

export const createPendingCheckout = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(pendingCheckoutSchema)
  .handler(async ({ data, context }) => {
    const { requireCustomerForUserId } = await import("@/lib/auth/authorization.server");
    await requireCustomerForUserId(context.userId);
    return createPendingCheckoutServer(data, getAuthenticatedUserId(context));
  });

