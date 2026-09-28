import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/lib/auth/verify.server.ts", import.meta.url), "utf8");
const start = source.indexOf("export async function requireFreshSession");
const end = source.indexOf("export function readCurrentSessionToken", start);
const fresh = source.slice(start, end);

test("fresh-session assurance uses Better Auth canonical session resolution", () => {
  assert.match(fresh, /auth\.api\.getSession\(\{ headers: request\.headers \}\)/);
  assert.match(fresh, /session\.session\.createdAt/);
  assert.doesNotMatch(fresh, /where token = \$1/);
  assert.doesNotMatch(fresh, /readSessionCookieToken\(\)/);
});

test("fresh-session assurance remains time bounded", () => {
  assert.match(fresh, /maxAgeSeconds = 60 \* 60/);
  assert.match(fresh, /Date\.now\(\) - createdAt > maxAgeSeconds \* 1000/);
  assert.match(fresh, /Fresh authentication required/);
});
