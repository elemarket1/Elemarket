import { selectedProvider } from "@/lib/providers/catalog.mjs";
import type { OtpProviderAdapter } from "./types";
import { getArkeselOtpAdapter } from "./providers/arkesel.server";
const factories: Record<string, () => OtpProviderAdapter> = { arkesel: getArkeselOtpAdapter };
export function getOtpAdapter(providerKey?: string): OtpProviderAdapter {
  const selected = selectedProvider("otp", providerKey ? { ...process.env, ELEMARKET_OTP_PROVIDER: providerKey } : process.env);
  for (const key of selected.required) if (!process.env[key]?.trim()) throw new Error(`otp provider '${selected.key}': missing configuration ${key}`);
  if (!Object.hasOwn(factories, selected.key)) throw new Error("otp is disabled");
  return factories[selected.key]();
}
