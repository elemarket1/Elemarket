import type { OtpProviderAdapter } from "./types";
import { getArkeselOtpAdapter } from "./providers/arkesel.server";

export function getOtpAdapter(providerKey?: string): OtpProviderAdapter {
  const selected = (providerKey ?? process.env.ELEMARKET_OTP_PROVIDER ?? "arkesel").trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,64}$/.test(selected)) throw new Error("Invalid OTP provider");
  if (selected === "arkesel") return getArkeselOtpAdapter();
  throw new Error(`OTP provider '${selected}' is not configured`);
}
