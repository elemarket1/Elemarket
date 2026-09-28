import { selectedProvider } from "@/lib/providers/catalog.mjs";
import type { PushProviderAdapter } from "./types";
import { getFcmPushAdapter } from "./providers/fcm.server";
const factories: Record<string, () => PushProviderAdapter> = { fcm: getFcmPushAdapter };
export function getPushProvider(providerKey?: string): PushProviderAdapter {
  const selected = selectedProvider("push", providerKey ? { ...process.env, ELEMARKET_PUSH_PROVIDER: providerKey } : process.env);
  for (const key of selected.required) if (!process.env[key]?.trim()) throw new Error(`push provider '${selected.key}': missing configuration ${key}`);
  if (!Object.hasOwn(factories, selected.key)) throw new Error("push is disabled");
  return factories[selected.key]();
}
