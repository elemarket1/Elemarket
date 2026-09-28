import { selectedProvider } from "@/lib/providers/catalog.mjs";
import type { EmailProviderAdapter } from "./types";
import { getResendEmailAdapter } from "./providers/resend.server";
const factories: Record<string, () => EmailProviderAdapter> = { resend: getResendEmailAdapter };
export function getEmailAdapter(providerKey?: string): EmailProviderAdapter {
  const selected = selectedProvider("email", providerKey ? { ...process.env, ELEMARKET_EMAIL_PROVIDER: providerKey } : process.env);
  for (const key of selected.required) if (!process.env[key]?.trim()) throw new Error(`email provider '${selected.key}': missing configuration ${key}`);
  if (!Object.hasOwn(factories, selected.key)) throw new Error("email is disabled");
  return factories[selected.key]();
}
