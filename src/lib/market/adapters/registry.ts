import { z } from "zod";
import { builtinDrivers } from "./builtin-drivers";
import { isWorkspacePreview } from "@/lib/env.server";
import { normalizeProviderKey } from "@/lib/market/provider-policy.server";
import { PreviewPaymentAdapter, type PaymentProviderAdapter } from "./payment";

/**
 * Provider-neutral integration registry.
 *
 * The marketplace core never imports or names a payment vendor. A provider
 * record supplies a driver_key, and deployment configuration maps that driver
 * to an adapter module. Only the adapter contains vendor-specific behavior.
 */
export async function getPaymentAdapter(providerKey: string, driverKey?: string): Promise<PaymentProviderAdapter> {
  const normalized = normalizeProviderKey(providerKey);
  if (normalized.startsWith("preview") && isWorkspacePreview()) {
    return new PreviewPaymentAdapter();
  }

  const driver = (driverKey ?? process.env[`ELEMARKET_PAYMENT_${normalized.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_DRIVER`] ?? "").trim();

  if (!/^[A-Za-z0-9_-]{2,64}$/.test(driver)) throw new Error("Invalid payment provider driver");

  if (!Object.hasOwn(builtinDrivers, driver)) throw new Error(`Payment provider driver '${driver}' is unavailable`);
  const adapter = await builtinDrivers[driver](normalized);
  for (const method of ["createPayment", "verifyWebhook", "parseWebhook", "verifyTransaction"] as const) {
    if (typeof adapter[method] !== "function") throw new Error(`Payment provider '${normalized}' missing required capability ${method}`);
  }
  const capabilities = z.object({
    initialize: z.literal(true), checkout: z.literal(true), verify: z.literal(true), webhook: z.literal(true),
    refund: z.boolean(), idempotentInitialization: z.literal(true), merchantAccount: z.boolean(),
    currencies: z.array(z.string().regex(/^[A-Z]{3}$/)).min(1),
    methods: z.array(z.enum(["mobile_money", "card", "bank_transfer"])).min(1),
  }).strict().safeParse(adapter.capabilities);
  if (!capabilities.success || !Array.isArray(adapter.checkoutHosts) || adapter.checkoutHosts.some(host => !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)))
    throw new Error(`Payment provider '${normalized}' has invalid capabilities`);
  if (adapter.capabilities.refund && typeof adapter.refundPayment !== "function") throw new Error("Payment refund capability has no implementation");
  return adapter;
}
