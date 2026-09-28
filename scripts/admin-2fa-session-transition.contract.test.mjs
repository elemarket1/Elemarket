import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("admin 2FA enrollment ends the pre-2FA session instead of bypassing session assurance", () => {
  const security = read("src/routes/admin/security.tsx");
  const authz = read("src/lib/auth/authorization.server.ts");
  assert.match(security, /authClient\.twoFactor\.verifyTotp/);
  assert.match(security, /authClient\.signOut\(\)/);
  assert.match(security, /elemarket\.admin\.post2faCallback/);
  assert.match(authz, /createdAt < enabledAt/);
});

test("admin sign-in preserves the dashboard destination through the 2FA challenge", () => {
  const admin = read("src/routes/admin/index.tsx");
  const twoFactor = read("src/routes/two-factor.tsx");
  assert.match(admin, /elemarket\.admin\.post2faCallback/);
  assert.match(admin, /callbackURL: "\/admin\/dashboard"/);
  assert.match(twoFactor, /sessionStorage\.getItem\("elemarket\.admin\.post2faCallback"\)/);
  assert.match(twoFactor, /callback === "\/admin\/dashboard" \? callback : "\/"/);
  assert.match(twoFactor, /sessionStorage\.removeItem\("elemarket\.admin\.post2faCallback"\)/);
});

test("2FA challenge cannot redirect an arbitrary client-supplied destination", () => {
  const twoFactor = read("src/routes/two-factor.tsx");
  assert.doesNotMatch(twoFactor, /window\.location\.assign\(callback\)/);
  assert.match(twoFactor, /callback === "\/admin\/dashboard" \? callback : "\/"/);
});


test("TanStack Start cookie adapter is the final Better Auth plugin", () => {
  const auth = read("src/lib/auth/server.ts");
  const bearer = auth.indexOf("bearer(),");
  const twoFactor = auth.indexOf("twoFactor({");
  const tanstack = auth.indexOf("tanstackStartCookies(),");
  assert.ok(bearer >= 0 && twoFactor > bearer && tanstack > twoFactor);
  assert.equal(auth.indexOf("tanstackStartCookies(),", tanstack + 1), -1);
});


test("admin authorization uses Better Auth canonical session resolution", () => {
  const authz = read("src/lib/auth/authorization.server.ts");
  assert.match(authz, /auth\.api\.getSession\(\{ headers: request\.headers \}\)/);
  assert.match(authz, /session\.user\.id !== userId/);
  assert.match(authz, /session\.session\.createdAt/);
  assert.doesNotMatch(authz, /readCurrentSessionToken\(\)/);
  assert.equal(authz.includes('from "session" where token=$1'), false);
});
