import type { PushProviderAdapter } from "./types";
import { getFcmPushAdapter } from "./providers/fcm.server";

export function getPushProvider(): PushProviderAdapter {
  const selected = (process.env.ELEMARKET_PUSH_PROVIDER || "fcm").trim().toLowerCase();
  if (selected === "fcm") return getFcmPushAdapter();
  throw new Error(`Unsupported push provider: ${selected}`);
}
