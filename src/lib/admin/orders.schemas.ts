import { z } from "zod";
export const operationalId = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_.:-]+$/);
export const pageInput = {
  page: z.number().int().min(0).max(10000).default(0),
  pageSize: z.number().int().min(1).max(50).default(20),
};
export const orderStatuses = [
  "payment_pending",
  "paid",
  "confirmed",
  "fulfilling",
  "shipped",
  "delivered",
  "completed",
  "cancelled",
  "disputed",
  "refund_pending",
  "refunded",
] as const;
export const supportStatuses = [
  "open",
  "waiting_customer",
  "waiting_support",
  "resolved",
  "closed",
] as const;
export const supportCategories = [
  "order",
  "payment",
  "delivery",
  "product",
  "merchant",
  "refund",
  "dispute",
  "account",
  "general",
] as const;
export const searchOrdersSchema = z
  .object({
    ...pageInput,
    searchBy: z.enum(["order", "payment_reference", "customer", "merchant"]).default("order"),
    query: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9_.:=-]+$/)
      .optional(),
    status: z.enum(orderStatuses).optional(),
    paymentStatus: z
      .enum(["initiated", "authorized", "completed", "failed", "refunded"])
      .optional(),
    deliveryStatus: z
      .enum([
        "pending",
        "packed",
        "shipped",
        "in_transit",
        "out_for_delivery",
        "delivered",
        "failed",
        "cancelled",
        "returned",
      ])
      .optional(),
    merchantId: operationalId.optional(),
    customerId: operationalId.optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    disputeStatus: z.enum(["open", "under_review", "resolved_refund", "closed"]).optional(),
    refundStatus: z
      .enum(["requested", "processing", "processed", "needs_attention", "failed", "cancelled"])
      .optional(),
    supportStatus: z.enum(supportStatuses).optional(),
  })
  .strict()
  .refine((x) => !x.from || !x.to || Date.parse(x.from) <= Date.parse(x.to), "Invalid date range");
export const orderInput = z.object({ orderId: operationalId }).strict();
export const orderSections = [
  "items",
  "payments",
  "webhooks",
  "delivery",
  "disputes",
  "returns",
  "refunds",
  "reconciliation",
  "timeline",
  "audit",
  "support",
] as const;
export const orderSectionInput = z
  .object({ orderId: operationalId, section: z.enum(orderSections), ...pageInput })
  .strict();
export const threadInput = z
  .object({ conversationId: operationalId, orderId: operationalId.nullable(), ...pageInput })
  .strict();
const actionBase = {
  conversationId: operationalId.nullable(),
  orderId: operationalId.nullable(),
  idempotencyKey: z.string().min(16).max(128),
};
export const supportActionInput = z.discriminatedUnion("action", [
  z.object({ ...actionBase, action: z.literal("open") }).strict(),
  z
    .object({ ...actionBase, action: z.literal("reply"), body: z.string().trim().min(1).max(4000) })
    .strict(),
  z
    .object({ ...actionBase, action: z.literal("note"), body: z.string().trim().min(1).max(4000) })
    .strict(),
  z
    .object({ ...actionBase, action: z.literal("assign"), assigneeId: operationalId.nullable() })
    .strict(),
  z
    .object({ ...actionBase, action: z.literal("status"), status: z.enum(supportStatuses) })
    .strict(),
  z.object({ ...actionBase, action: z.literal("escalate") }).strict(),
  z
    .object({
      ...actionBase,
      action: z.literal("classify"),
      category: z.enum(supportCategories),
      subject: z.string().trim().min(1).max(160),
    })
    .strict(),
  z.object({ ...actionBase, action: z.literal("link") }).strict(),
]);
export type SafeRow = Record<string, string | number | boolean | null>;
export type OrderSearchInput = z.input<typeof searchOrdersSchema>;
export type SupportActionInput = z.infer<typeof supportActionInput>;
