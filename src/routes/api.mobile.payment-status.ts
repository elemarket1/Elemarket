import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { auth } from "@/lib/auth/server";
import { requireCustomerPayment } from "@/lib/market/ownership.server";
import { requireCustomerForUserId } from "@/lib/auth/authorization.server";
import { customerPaymentOutcome } from "@/lib/market/payment-status.server";
import { readBodyWithLimit } from "@/lib/security/body.server";
import { enforceRateLimit, rateLimitResponse } from "@/lib/security/rate-limit.server";
import { assertSameSiteRequest } from "@/lib/auth/isolation.server";

const schema = z.object({ paymentId: z.string().min(1).max(128) });

export const Route = createFileRoute("/api/mobile/payment-status")({
  server: { handlers: { POST: async ({ request }) => {
    assertSameSiteRequest();
    const current = await auth.api.getSession({ headers: request.headers });
    if (!current?.user) return Response.json({ error: "Unauthorized" }, { status: 401, headers: { "cache-control": "no-store" } });
    try {
      await requireCustomerForUserId(current.user.id);
      await enforceRateLimit("customer-payment-status", { windowSeconds: 60, maxRequests: 30, subject: current.user.id });
    } catch (error) {
      const limited = rateLimitResponse(error);
      if (limited) return limited;
      throw error;
    }
    let raw: string;
    try { raw = await readBodyWithLimit(request, 8 * 1024); } catch { return Response.json({ error: "Request too large" }, { status: 413 }); }
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
    const parsed = schema.safeParse(body);
    if (!parsed.success) return Response.json({ error: "Invalid payment request" }, { status: 400 });
    try {
      const payment = await requireCustomerPayment(parsed.data.paymentId, current.user.id);
      return Response.json(await customerPaymentOutcome(payment.id,current.user.id), { headers: { "cache-control": "no-store" } });
    } catch {
      return Response.json({ error: "Payment not found" }, { status: 404, headers: { "cache-control": "no-store" } });
    }
  } } },
});
