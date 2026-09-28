import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("auth hardening: production does not trust localhost when BETTER_AUTH_URL is explicit", () => {
  const server = read("src/lib/auth/server.ts");
  assert.match(server, /const trustedOrigins: string\[\] = explicitBaseURL\s*\n\s*\? \[explicitBaseURL, \.\.\.configuredTrustedOrigins\]/);
  assert.doesNotMatch(server, /explicitBaseURL\s*\n\s*\? \[explicitBaseURL, \.\.\.LOCAL_DEV_ORIGINS\]/);
});

test("auth hardening: persistent rate limiting and sensitive endpoint rules exist", () => {
  const server = read("src/lib/auth/server.ts");
  assert.match(server, /rateLimit:\s*\{/);
  assert.match(server, /storage:\s*"database"/);
  for (const rule of ["/sign-in/email", "/sign-up/email", "/forget-password", "/change-password", "/change-email"]) {
    assert.match(server, new RegExp(rule.replaceAll("/", "\\/") + ""));
  }
  const migration = read("migrations/0013_auth_hardening.sql");
  assert.match(migration, /create table if not exists "rateLimit"/i);
  assert.match(migration, /"lastRequest" bigint/i);
});

test("auth hardening: explicit role boundary and server-only authorization helpers exist", () => {
  const migration = read("migrations/0013_auth_hardening.sql");
  assert.match(migration, /check \("role" in \('customer', 'merchant', 'admin'\)\)/i);
  const authz = read("src/lib/auth/authorization.server.ts");
  assert.match(authz, /requireRole/);
  assert.match(authz, /requireAdmin/);
  assert.match(authz, /requireMerchantOrAdmin/);
  assert.match(authz, /requireUserId/);
  assert.match(authz, /where id = \$1/);
});

test("auth hardening: sensitive actions have a server-side fresh-session primitive", () => {
  const verify = read("src/lib/auth/verify.server.ts");
  assert.match(verify, /export async function requireFreshSession/);
  assert.match(verify, /auth\.api\.getSession\(\{ headers: request\.headers \}\)/);
  assert.match(verify, /session\.session\.createdAt/);
  assert.match(verify, /Fresh authentication required/);
});

test("auth hardening: shared deployments fail closed on origin and proxy identity configuration", () => {
  const server = read("src/lib/auth/server.ts");
  assert.match(server, /Shared environments require BETTER_AUTH_URL/);
  assert.match(server, /BETTER_AUTH_URL to use HTTPS/);
  assert.match(server, /BETTER_AUTH_TRUSTED_ORIGINS/);
  assert.match(server, /BETTER_AUTH_IP_HEADER/);
  assert.match(server, /BETTER_AUTH_TRUSTED_PROXIES/);
  assert.match(server, /disableCSRFCheck: false/);
  assert.match(server, /disableOriginCheck: false/);
  assert.match(server, /cookiePrefix: "elemarket"/);
});
