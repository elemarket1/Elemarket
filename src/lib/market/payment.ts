import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware, getAuthenticatedUserId } from "@/lib/auth/middleware";

export type PaymentStatus = "initiated" | "authorized" | "completed" | "failed" | "refunded";

const createIntentSchema = z.object({
  paymentId: z.string().min(1).max(128),
  providerKey: z.string().min(2).max(128).optional(),
});

export const createPaymentIntent = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(createIntentSchema)
  .handler(async ({ data, context }) => {
    const [{ requireCustomerForUserId }, { enforceRateLimit }] = await Promise.all([
      import("@/lib/auth/authorization.server"),
      import("@/lib/security/rate-limit.server"),
    ]);
    await requireCustomerForUserId(context.userId);
    const userId = getAuthenticatedUserId(context);
    await enforceRateLimit("payment-intent", { windowSeconds: 60, maxRequests: 12, subject: userId });
    const { createExternalPaymentIntent } = await import("@/lib/market/payment.server");
    return createExternalPaymentIntent({ ...data, userId: userId });
  });

export const getCustomerPaymentStatus = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.object({ paymentId: z.string().min(1).max(128) }))
  .handler(async ({ data, context }) => {
    const [{ requireCustomerForUserId }, { enforceRateLimit }, { requireCustomerPayment }] = await Promise.all([
      import("@/lib/auth/authorization.server"),
      import("@/lib/security/rate-limit.server"),
      import("@/lib/market/ownership.server"),
    ]);
    await requireCustomerForUserId(context.userId);
    const userId = getAuthenticatedUserId(context);
    await enforceRateLimit("payment-status", { windowSeconds: 60, maxRequests: 30, subject: userId });
    const owned = await requireCustomerPayment(data.paymentId, userId);
    const { customerPaymentOutcome } = await import("@/lib/market/payment-status.server");
    return customerPaymentOutcome(owned.id,userId);
  });

export const completePreviewPayment = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ paymentId: z.string().min(1).max(128) }))
  .handler(async ({ data, context }) => {
    const { requireCustomerForUserId } = await import("@/lib/auth/authorization.server");
    await requireCustomerForUserId(context.userId);
    const userId = getAuthenticatedUserId(context);
    const { completePreviewPaymentServer } = await import("@/lib/market/payment.server");
    return completePreviewPaymentServer({ paymentId: data.paymentId, userId: userId });
  });
