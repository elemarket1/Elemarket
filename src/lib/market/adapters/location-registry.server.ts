import { selectedProvider } from "@/lib/providers/catalog.mjs";
import type { LocationProvider } from "./location-provider";
import { GeoapifyLocationProvider } from "./providers/geoapify.server";
const factories: Record<string, () => LocationProvider> = { geoapify: () => new GeoapifyLocationProvider(process.env.GEOAPIFY_API_KEY!.trim()) };
export function getLocationProvider(): LocationProvider {
  const selected = selectedProvider("location");
  for (const key of selected.required) if (!process.env[key]?.trim()) throw new Error(`location provider '${selected.key}': missing configuration ${key}`);
  return factories[selected.key]();
}
