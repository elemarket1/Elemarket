import type { PaymentProviderAdapter } from "./payment";
/** Explicit imports let the production bundler include installed adapter modules. */
export const builtinDrivers: Record<string, (providerKey: string) => Promise<PaymentProviderAdapter>> = {
  paystack: async (providerKey) => (await import("./providers/paystack")).createPaymentAdapter({ providerKey }),
};
