import { env } from "@/lib/env.server";
import { S3StorageProvider } from "./s3.server";
function required(key: string): string {
  const value = env(key);
  if (!value) throw new Error(`storage provider r2: missing configuration ${key}`);
  return value;
}
/** Legacy R2 configuration is confined to this adapter. */
export class CloudflareR2StorageProvider extends S3StorageProvider {
  constructor() {
    const account = required("CLOUDFLARE_R2_ACCOUNT_ID");
    const bucket = required("CLOUDFLARE_R2_BUCKET");
    if (!/^[a-f0-9]{32}$/i.test(account)) throw new Error("CLOUDFLARE_R2_ACCOUNT_ID is invalid");
    super({ endpoint: `https://${bucket}.${account}.r2.cloudflarestorage.com`, region: "auto", bucket,
      accessKeyId: required("CLOUDFLARE_R2_ACCESS_KEY_ID"), secretAccessKey: required("CLOUDFLARE_R2_SECRET_ACCESS_KEY"), virtualHosted: true });
  }
}
