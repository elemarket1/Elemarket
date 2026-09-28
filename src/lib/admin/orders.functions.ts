import { createServerFn } from "@tanstack/react-start";
import { authMiddleware, getAuthenticatedUserId } from "@/lib/auth/middleware";
import { requireAdminCapability } from "./permissions.server";
import { enforceRateLimit } from "@/lib/security/rate-limit.server";
import { auditAdminRead, orderOverview, orderSection, searchOrders } from "./orders.server";
import { orderInput, orderSectionInput, searchOrdersSchema } from "./orders.schemas";

export const searchAdminOrders = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(searchOrdersSchema)
  .handler(async ({ context, data }) => {
    const actor = getAuthenticatedUserId(context);
    for (const cap of ["read_order", "read_customer", "read_merchant", "read_payment"] as const)
      await requireAdminCapability(cap, actor);
    await enforceRateLimit("admin-order-search", {
      subject: actor,
      windowSeconds: 60,
      maxRequests: 40,
    });
    await auditAdminRead(actor, null, "search");
    return searchOrders(data);
  });
export const getAdminOrder = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(orderInput)
  .handler(async ({ context, data }) => {
    const actor = getAuthenticatedUserId(context);
    for (const cap of ["read_order", "read_customer", "read_merchant", "read_payment"] as const)
      await requireAdminCapability(cap, actor);
    await enforceRateLimit("admin-order-overview", {
      subject: actor,
      windowSeconds: 60,
      maxRequests: 60,
    });
    await auditAdminRead(actor, data.orderId, "overview");
    return orderOverview(data.orderId);
  });
export const getAdminOrderSection = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(orderSectionInput)
  .handler(async ({ context, data }) => {
    const actor = getAuthenticatedUserId(context);
    await requireAdminCapability("read_order", actor);
    if (
      [
        "payments",
        "webhooks",
        "refunds",
        "disputes",
        "reconciliation",
        "timeline",
        "audit",
      ].includes(data.section)
    )
      await requireAdminCapability("read_payment", actor);
    if (["support", "timeline", "audit"].includes(data.section))
      await requireAdminCapability("read_support", actor);
    await enforceRateLimit("admin-order-section", {
      subject: actor,
      windowSeconds: 60,
      maxRequests: 120,
    });
    await auditAdminRead(actor, data.orderId, data.section);
    return orderSection(data);
  });
