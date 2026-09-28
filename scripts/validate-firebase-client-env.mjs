#!/usr/bin/env node
if (process.env.ELEMARKET_PUSH_PROVIDER === "disabled") {
  console.log("[firebase] push disabled for this deployment");
  process.exit(0);
}
const required = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_APP_ID",
  "VITE_FIREBASE_VAPID_KEY",
];
const missing = required.filter((key) => !process.env[key]?.trim());
if (missing.length) {
  console.error(`[firebase] missing web push build variables: ${missing.join(", ")}`);
  process.exit(1);
}
try {
  new URL(`https://${process.env.VITE_FIREBASE_AUTH_DOMAIN}`);
} catch {
  console.error("[firebase] VITE_FIREBASE_AUTH_DOMAIN is invalid");
  process.exit(1);
}
console.log("[firebase] web push build configuration validated.");
