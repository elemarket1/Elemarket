import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const headers = fs.readFileSync("src/lib/security/headers.ts", "utf8");
const start = fs.readFileSync("src/start.ts", "utf8");
const router = fs.readFileSync("src/router.tsx", "utf8");
const middleware = fs.readFileSync("server/middleware/security.ts", "utf8");

 test("production CSP accepts the request-scoped TanStack Start nonce without unsafe-inline", () => {
  assert.match(headers, /nonce\?:\s*string/);
  assert.match(headers, /nonce-\$\{options\.nonce\}/);
  assert.doesNotMatch(headers, /script-src[^\n]*unsafe-inline/);
});

test("TanStack Start receives the same request-scoped nonce used by the CSP", () => {
  assert.match(start, /createCsrfMiddleware\(\{/);
  assert.match(start, /filter: \(ctx\) => ctx\.handlerType === "serverFn"/);
  assert.match(start, /createMiddleware\(\)\.server/);
  assert.match(start, /const cspNonce = createCspNonce\(\)/);
  assert.match(start, /securityHeaders\(\{ production: true, nonce: cspNonce \}\)/);
  assert.match(start, /context:\s*\{ cspNonce \}/);
  assert.match(start, /requestMiddleware: \[requestLoggingMiddleware, csrfMiddleware, securityMiddleware\]/);
  assert.match(router, /import \{ getStartContext \} from "@tanstack\/start-storage-context";/);
  assert.match(router, /const context = getStartContext\(\)\.contextAfterGlobalMiddlewares;/);
  assert.match(router, /typeof context\.cspNonce !== "string"/);
  assert.match(router, /return context\.cspNonce;/);
  assert.match(router, /meta\[property=csp-nonce\]/);
  assert.match(router, /ssr:\s*\{\s*nonce:\s*getCspNonce\(\)/s);
});

test("the direct storage-context dependency is declared instead of relying on a transitive package", () => {
  const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
  assert.equal(packageJson.dependencies["@tanstack/start-storage-context"], "1.167.30");
});

test("late security middleware never replaces a Start-generated nonce CSP", () => {
  assert.match(middleware, /key === "Content-Security-Policy" && headers\.has\(key\)/);
});
