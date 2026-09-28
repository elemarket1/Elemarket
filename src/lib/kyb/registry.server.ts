import { selectedProvider } from "@/lib/providers/catalog.mjs";
import type { KYBProvider } from "./provider";
import { FylingsAdapter } from "./providers/fylings.server";
const factories: Record<string, () => KYBProvider> = { fylings: () => new FylingsAdapter() };
export function getKybProvider(): KYBProvider | null {
  const selected = selectedProvider("kyb");
  if (selected.key === "manual") return null;
  for (const key of selected.required) if (!process.env[key]?.trim()) throw new Error(`kyb provider '${selected.key}': missing configuration ${key}`);
  return factories[selected.key]();
}
