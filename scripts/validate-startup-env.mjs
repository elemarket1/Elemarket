#!/usr/bin/env node
const env = (key) => process.env[key]?.trim() || undefined;
const explicitEnvironment = (env("ELEMARKET_ENV") || "").toLowerCase();
const production = process.argv.includes("--require-shared") || explicitEnvironment === "production" || explicitEnvironment === "staging" || Boolean(env("VERCEL") || process.env.NODE_ENV === "production") || Boolean(env("DATABASE_URL"));
if (production && !["production", "staging"].includes(explicitEnvironment)) {
  console.error("[startup] ELEMARKET_ENV must be explicitly set to production or staging for a shared deployment.");
  process.exit(1);
}

if (!production) {
console.log("[startup] local/preview environment — production secret validation skipped.");
  process.exit(0);
}

if (env("VERCEL") !== "1" && (env("ELEMARKET_TRUST_PROXY") !== "1" || env("ELEMARKET_PROXY_OVERWRITES_FORWARDED_FOR") !== "1" || !env("BETTER_AUTH_IP_HEADER"))) {
  console.error("[startup] Trusted client-IP configuration is required: configure a sanitizing ingress, ELEMARKET_TRUST_PROXY=1, ELEMARKET_PROXY_OVERWRITES_FORWARDED_FOR=1, and BETTER_AUTH_IP_HEADER.");
  process.exit(1);
}
const required = ["DATABASE_URL", "REDIS_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "CRON_SECRET", "ELEMARKET_MERCHANT_DATA_ENCRYPTION_KEY", "ELEMARKET_ENTERPRISE_SYNC_SECRET"];
required.push("ELEMARKET_PUBLIC_URL", "GEOAPIFY_API_KEY", "ARKESEL_API_KEY", "ARKESEL_OTP_SENDER_ID",
  "CLOUDFLARE_R2_ACCOUNT_ID", "CLOUDFLARE_R2_ACCESS_KEY_ID", "CLOUDFLARE_R2_SECRET_ACCESS_KEY", "CLOUDFLARE_R2_BUCKET",
  "ELEMARKET_PAYMENT_PROVIDERS", "ELEMARKET_SETTLEMENT_MODE");
function fail(message) { console.error(`[startup] ${message}`); process.exit(1); }
const pgSslMode = env("PG_SSL_MODE");
let databaseHostname = "";
try { databaseHostname = new URL(env("DATABASE_URL")).hostname; } catch { fail("DATABASE_URL must be a valid PostgreSQL URL"); }
const runningOnRender = env("RENDER") === "true" || env("RENDER") === "1";
const renderInternalPostgres = /^dpg-[a-z0-9][a-z0-9-]*$/i.test(databaseHostname);
if (runningOnRender || renderInternalPostgres) {
  if (!["require", "verify-full"].includes(pgSslMode ?? "")) {
    fail("Render internal PostgreSQL requires PG_SSL_MODE=require or verify-full; use require for the internal connection");
  }
} else if (pgSslMode !== "verify-full") {
  fail("PG_SSL_MODE=verify-full is required for non-Render production PostgreSQL");
}
const redisUrl = env("REDIS_URL");
let redisProtocol = "";
let redisHostname = "";
try {
  const parsedRedisUrl = new URL(redisUrl);
  redisProtocol = parsedRedisUrl.protocol;
  redisHostname = parsedRedisUrl.hostname;
} catch { fail("REDIS_URL must be a valid Redis or HTTPS URL"); }
const isRenderInternalKeyValueHost = redisProtocol === "redis:" && /^red-[a-z0-9][a-z0-9-]*$/i.test(redisHostname);
if (redisProtocol === "https:") {
  if (!env("REDIS_HTTP_TOKEN")) fail("REDIS_HTTP_TOKEN is required when REDIS_URL is an HTTPS Redis REST endpoint");
} else if (redisProtocol === "redis:") {
  // Render's private Key Value connection URL is redis://red-...:6379.
  // Render does not guarantee a public RENDER=true runtime variable for every
  // Docker deployment, so identify the documented private hostname form too.
  if (!runningOnRender && !isRenderInternalKeyValueHost) {
    fail("redis:// connections are permitted only for Render private-network Key Value; use rediss:// for external native Redis");
  }
} else if (redisProtocol !== "rediss:") {
  fail("REDIS_URL must use https://, rediss://, or Render internal redis://");
}
if (env("ELEMARKET_SETTLEMENT_MODE") !== "provider_direct_uncontrolled") fail("Configure provider_direct_uncontrolled explicitly: the installed adapters cannot guarantee settlement 24 hours after delivery");
for (const [key, supported] of [["ELEMARKET_STORAGE_PROVIDER","r2"],["ELEMARKET_LOCATION_PROVIDER","geoapify"],["ELEMARKET_OTP_PROVIDER","arkesel"],["ELEMARKET_EMAIL_PROVIDER","resend"]]) {
  if (env(key) && env(key) !== supported) fail(`${key}: unsupported production provider`);
}
const providers = (env("ELEMARKET_PAYMENT_PROVIDERS") ?? "").split(",").map(x=>x.trim()).filter(Boolean);
for (const provider of providers) {
  if (!/^[a-z0-9_-]{2,64}$/.test(provider) || provider.startsWith("preview")) fail("Invalid production payment provider");
  const prefix = `ELEMARKET_PAYMENT_${provider.toUpperCase().replace(/[^A-Z0-9]+/g,"_")}`;
  required.push(`${prefix}_DRIVER`, `${prefix}_SECRET`);
  if (provider !== "paystack") required.push(`${prefix}_CHECKOUT_HOSTS`);
  const driver = env(`${prefix}_DRIVER`);
  if (driver !== "paystack") fail("Production payment contract verification currently supports the installed paystack driver only");
}
for (const key of ["BETTER_AUTH_URL", "ELEMARKET_PUBLIC_URL"]) {
  try { const url = new URL(env(key)); if (url.protocol !== "https:" || url.username || url.password || ["localhost","127.0.0.1","[::1]"].includes(url.hostname)) throw new Error(); }
  catch { fail(`${key} requires a public HTTPS URL`); }
}
if (redisProtocol === "https:") {
  try { const url = new URL(redisUrl); if (url.username || url.password || ["localhost","127.0.0.1","[::1]"].includes(url.hostname)) throw new Error(); }
  catch { fail("REDIS_URL HTTPS REST endpoint is invalid"); }
}
for (const key of ["CRON_SECRET","ELEMARKET_ENTERPRISE_SYNC_SECRET"]) if ((env(key)?.length ?? 0)<32) fail(`${key} must be at least 32 characters`);
const missing = required.filter((key) => !env(key));
if (missing.length) {
  console.error(`[startup] missing required production environment variables: ${missing.join(", ")}`);
  process.exit(1);
}

const merchantEncryptionKey = env("ELEMARKET_MERCHANT_DATA_ENCRYPTION_KEY");
if (!merchantEncryptionKey) {
  console.error("[startup] ELEMARKET_MERCHANT_DATA_ENCRYPTION_KEY is required in production for merchant compliance data encryption.");
  process.exit(1);
}
const keyBytes = /^[0-9a-fA-F]{64}$/.test(merchantEncryptionKey) ? 32 : Buffer.from(merchantEncryptionKey, "base64url").length;
if (keyBytes !== 32) {
  console.error("[startup] ELEMARKET_MERCHANT_DATA_ENCRYPTION_KEY must encode exactly 32 bytes.");
  process.exit(1);
}

const previousEncryptionKey = env("ELEMARKET_MERCHANT_DATA_ENCRYPTION_KEY_PREVIOUS");
if (previousEncryptionKey) {
  const previousBytes = /^[0-9a-fA-F]{64}$/.test(previousEncryptionKey) ? 32 : Buffer.from(previousEncryptionKey, "base64url").length;
  if (previousBytes !== 32) {
    console.error("[startup] ELEMARKET_MERCHANT_DATA_ENCRYPTION_KEY_PREVIOUS must encode exactly 32 bytes.");
    process.exit(1);
  }
}

const secret = env("BETTER_AUTH_SECRET");
if (!secret || secret.length < 32) {
  console.error("[startup] BETTER_AUTH_SECRET must be at least 32 characters in production.");
  process.exit(1);
}

const authUrl = env("BETTER_AUTH_URL");
try {
  const url = new URL(authUrl);
  if (url.protocol !== "https:") throw new Error("must use HTTPS");
  if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("must not point to loopback");
} catch (error) {
  console.error(`[startup] BETTER_AUTH_URL is invalid for production: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

if (env("VITE_AUTH_ENABLED") === "false") {
  console.error("[startup] VITE_AUTH_ENABLED=false is forbidden in shared environments.");
  process.exit(1);
}

const emailProvider = (env("ELEMARKET_EMAIL_PROVIDER") || "resend").toLowerCase();
if (emailProvider === "resend") {
  const emailRequired = ["RESEND_API_KEY", "RESEND_FROM_EMAIL", "RESEND_WEBHOOK_SECRET"];
  const missingEmail = emailRequired.filter((key) => !env(key));
  if (missingEmail.length) {
    console.error(`[startup] Resend email provider requires: ${missingEmail.join(", ")}`);
    process.exit(1);
  }
}

if (env("ELEMARKET_REAL_API_MODE") === "1") {
  const publicUrl = env("ELEMARKET_PUBLIC_URL");
  if (!publicUrl) { console.error("[startup] real API mode requires ELEMARKET_PUBLIC_URL"); process.exit(1); }
  try { if (new URL(publicUrl).protocol !== "https:") throw new Error("ELEMARKET_PUBLIC_URL must use HTTPS"); }
  catch (error) { console.error(`[startup] ELEMARKET_PUBLIC_URL is invalid: ${error instanceof Error ? error.message : String(error)}`); process.exit(1); }

}

const pushProvider = (env("ELEMARKET_PUSH_PROVIDER") || "fcm").toLowerCase();
if (!["fcm", "disabled"].includes(pushProvider)) fail("Unsupported push provider");
if (pushProvider === "fcm") {
  const raw = env("FCM_SERVICE_ACCOUNT_JSON");
  if (!raw) { console.error("[startup] FCM push provider requires FCM_SERVICE_ACCOUNT_JSON"); process.exit(1); }
  try {
    const sa = JSON.parse(raw);
    if (!sa?.project_id || !sa?.client_email || !sa?.private_key) throw new Error("missing project_id/client_email/private_key");
  } catch (error) {
    console.error(`[startup] FCM_SERVICE_ACCOUNT_JSON is invalid: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

console.log("[startup] production environment validation passed.");
