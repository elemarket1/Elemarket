import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const login = await readFile(new URL("src/routes/merchant/login.tsx", root), "utf8");
const context = await readFile(new URL("src/lib/auth/merchant-context.functions.ts", root), "utf8");
const auth = await readFile(new URL("src/lib/auth/authorization.server.ts", root), "utf8");
const customerLogin = await readFile(new URL("src/routes/login.tsx", root), "utf8");

test("merchant login has a dedicated route and merchant context", () => {
  assert.match(login, /createFileRoute\("\/merchant\/login"\)/);
  assert.match(login, /getMerchantLoginContext/);
  assert.match(login, /\/merchant\/dashboard/);
});

test("merchant login requires an active merchant membership", () => {
  assert.match(context, /from merchant_accounts/);
  assert.match(context, /status='active'/);
  assert.match(context, /authorized: true/);
});

test("customer and merchant authorization contexts can coexist", () => {
  assert.match(auth, /role === "admin" \|\| principal\.role === "merchant"/);
  assert.match(auth, /from merchant_accounts/);
  assert.match(auth, /return \{ userId, role: "merchant" \}/);
  assert.match(customerLogin, /window\.location\.href = "\/"/);
});

test("merchant login exposes only the customer-login path; registration stays on the homepage", () => {
  assert.match(login, /to="\/login"/);
  assert.doesNotMatch(login, /to="\/merchant\/register"/);
});
