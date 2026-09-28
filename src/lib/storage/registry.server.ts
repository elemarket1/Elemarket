import { selectedProvider } from "@/lib/providers/catalog.mjs";
import { CloudflareR2StorageProvider } from "./r2.server";
import { S3StorageProvider } from "./s3.server";
import type { StorageProvider } from "./provider";
const factories: Record<string, () => StorageProvider> = {
  r2: () => new CloudflareR2StorageProvider(),
  s3: () => new S3StorageProvider({ endpoint: process.env.STORAGE_ENDPOINT!.trim(), region: process.env.STORAGE_REGION!.trim(), bucket: process.env.STORAGE_BUCKET!.trim(), accessKeyId: process.env.STORAGE_ACCESS_KEY_ID!.trim(), secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY!.trim() }),
};
export function getStorageProvider(): StorageProvider {
  const selected = selectedProvider("storage");
  for (const key of selected.required) if (!process.env[key]?.trim()) throw new Error(`storage provider '${selected.key}': missing configuration ${key}`);
  return factories[selected.key]();
}
