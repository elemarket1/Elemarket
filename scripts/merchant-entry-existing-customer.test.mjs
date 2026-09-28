import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);

async function source(file) {
  return readFile(resolve(root, file), "utf8");
}

test("merchant registration is exposed from the homepage only", async () => {
  const gates = await source("src/lib/auth/gates.tsx");
  const home = await source("src/routes/index.tsx");
  const profile = await source("src/routes/profile.tsx");
  const header = await source("src/components/market-header.tsx");
  const login = await source("src/routes/login.tsx");
  assert.match(home, /to="\/merchant\/register"/);
  assert.doesNotMatch(gates, /merchant\/register/);
  assert.doesNotMatch(profile, /merchant\/register/);
  assert.doesNotMatch(header, /merchant\/register/);
  assert.doesNotMatch(login, /to="\/merchant\/register"/);
});

test("merchant registration has an existing-customer path", async () => {
  const register = await source("src/routes/merchant/register.tsx");
  assert.match(register, /useCurrentUserState/);
  assert.match(register, /existingCustomer/);
  assert.match(register, /createMerchantApplication/);
  assert.match(register, /Submit (?:merchant )?application/i);
  assert.match(register, /if \((?:existingCustomer|signedIn)\)[\s\S]*?return;/);
});

test("merchant application still rejects accounts that already have merchant/admin access", async () => {
  const account = await source("src/lib/auth/account.functions.ts");
  assert.match(account, /role === "admin" \|\| user\[0\]\.role === "merchant"/);
});
