import { requireAdminForUserId } from "@/lib/auth/authorization.server";
import { requireFreshSession } from "@/lib/auth/verify.server";

export const ADMIN_CAPABILITIES = [
  "read_order",
  "read_payment",
  "read_customer",
  "read_merchant",
  "read_support",
  "write_support",
  "manage_dispute",
  "initiate_refund",
  "change_order_state",
  "manage_merchant",
  "manage_platform_settings",
] as const;
export type AdminCapability = (typeof ADMIN_CAPABILITIES)[number];
/** One role today, separate capability gates so future staff roles fail closed. */
export async function requireAdminCapability(
  capability: AdminCapability,
  authenticatedUserId: string,
  mutation = false,
) {
  if (!ADMIN_CAPABILITIES.includes(capability)) throw new Error("Forbidden");
  const principal = await requireAdminForUserId(authenticatedUserId);
  if (mutation && (await requireFreshSession()) !== principal.userId) throw new Error("Forbidden");
  return principal;
}
