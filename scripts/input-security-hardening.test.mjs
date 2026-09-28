import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const headers = fs.readFileSync("src/lib/security/headers.ts", "utf8");
const auth = fs.readFileSync("src/lib/auth/server.ts", "utf8");
const env = fs.readFileSync("src/lib/env.server.ts", "utf8");
const limiter = fs.readFileSync("src/lib/security/rate-limit.server.ts", "utf8");

test("CSP does not allow arbitrary inline scripts or wildcard websocket connections", () => {
  assert.doesNotMatch(headers, /script-src[^\n]*unsafe-inline/);
  assert.doesNotMatch(headers, /connect-src[^\n]*\bwss:\b/);
  assert.match(headers, /style-src-attr 'unsafe-inline'/);
});

test("Better Auth production/shared cookies are explicitly HttpOnly, Secure and SameSite=Lax", () => {
  assert.match(auth, /defaultCookieAttributes/);
  assert.match(auth, /httpOnly:\s*true/);
  assert.match(auth, /sameSite:\s*["']lax["']/);
  assert.match(auth, /useSecureCookies:\s*deployed/);
});

test("trusted proxy mode requires an explicit header-overwrite deployment contract", () => {
  assert.match(env, /ELEMARKET_PROXY_OVERWRITES_FORWARDED_FOR/);
  assert.match(env, /ELEMARKET_TRUST_PROXY=1 requires/);
  assert.match(limiter, /x-vercel-forwarded-for/);
  assert.doesNotMatch(limiter, /cf-connecting-ip/);
  assert.doesNotMatch(limiter, /headers\.get("x-real-ip")/);
});
