import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql } from "@/lib/db";
import { authMiddleware, getAuthenticatedUserId } from "@/lib/auth/middleware";
import { requireAdminForUserId } from "@/lib/auth/authorization.server";
import { requireFreshSession } from "@/lib/auth/verify.server";
import { runMerchantKyb } from "@/lib/kyb/index.server";
import { geocodeAddressServer } from "@/lib/market/adapters/location.server";

const reviewSchema = z.object({
  applicationId: z.string().min(1).max(128),
  action: z.enum(["start_review", "approve", "reject"]),
  reason: z.string().max(1000).optional(),
});

export const reviewMerchantApplication = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(reviewSchema)
  .handler(async ({ data, context }) => {
    const userId = getAuthenticatedUserId(context);
    await requireAdminForUserId(userId);
    await requireFreshSession();
    if (data.action === "start_review") {
      await runMerchantKyb(data.applicationId);
    }
    const sql = await getSql();

    if (data.action === "approve") {
      const applicationRows = await sql.query<{ address: string }>(
        `select address from merchant_applications where id=$1 limit 1`,
        [data.applicationId],
      );
      const application = applicationRows[0];
      if (!application) throw new Error("Merchant application not found");

      // Merchant records require coordinates for nearby-store discovery. Resolve
      // the submitted business address before the approval transaction; if
      // geocoding fails, approval does not proceed.
      const location = await geocodeAddressServer(application.address);
      const reviewed = await sql.query<{ result: unknown }>(
        `select review_merchant_application($1,$2,'approve',null) as result`,
        [data.applicationId, userId],
      );
      const reviewResult = reviewed[0]?.result;
      const activated = await sql.query<{ result: unknown }>(
        `select activate_approved_merchant_application($1,$2,$3,$4,$5,$6) as result`,
        [
          data.applicationId,
          userId,
          location.latitude,
          location.longitude,
          location.city ?? location.state ?? "Ghana",
          location.state ?? location.city ?? "Ghana",
        ],
      );
      return { review: reviewResult, activation: activated[0]?.result ?? null };
    }

    const rows = await sql.query<{ result: unknown }>(
      `select review_merchant_application($1,$2,$3,$4) as result`,
      [data.applicationId, userId, data.action, data.reason ?? null],
    );
    return rows[0]?.result ?? null;
  });
