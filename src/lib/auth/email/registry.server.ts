import type { EmailProviderAdapter } from "./types";
import { getResendEmailAdapter } from "./providers/resend.server";

export function getEmailAdapter(providerKey?: string): EmailProviderAdapter {
  const selected = (providerKey ?? process.env.ELEMARKET_EMAIL_PROVIDER ?? "resend").trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,64}$/.test(selected)) throw new Error("Invalid email provider");
  if (selected === "resend") return getResendEmailAdapter();
  throw new Error(`Email provider '${selected}' is not configured`);
}
