import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const root = new URL("../", import.meta.url);
const read = (file) => readFile(new URL(file, root), "utf8");

test("merchant workspace accepts customer identities only through active merchant membership", async () => {
  const auth = await read("src/lib/auth/authorization.server.ts");
  const dash = await read("src/routes/merchant/dashboard.functions.ts");
  assert.match(auth, /requireMerchantWorkspaceForUserId/);
  assert.match(auth, /merchant_accounts/);
  assert.match(auth, /status = 'active'/);
  assert.match(dash, /requireMerchantWorkspaceForUserId/);
});

test("merchant dashboard never uses an admin wildcard and scopes by membership", async () => {
  const dash = await read("src/routes/merchant/dashboard.functions.ts");
  assert.doesNotMatch(dash, /principal\.role === ["']admin["'].*\?\? null/s);
  assert.match(dash, /where m\.id = any\(\$1::text\[\]\)/);
});

test("merchant listings are server-authorized and start pending review", async () => {
  const dash = await read("src/routes/merchant/dashboard.functions.ts");
  assert.match(dash, /createMerchantListing/);
  assert.match(dash, /requireMerchantAccessForUserId/);
  assert.match(dash, /pending_review/);
  assert.match(dash, /record_audit_event/);
});

test("merchant registration is not advertised from customer login/header", async () => {
  const login = await read("src/routes/login.tsx");
  const header = await read("src/components/market-header.tsx");
  assert.doesNotMatch(login, /merchant\/register/);
  assert.doesNotMatch(header, /Become a merchant/);
});

test("admin sensitive reveal is explicit, authorized and audited", async () => {
  const admin = await read("src/routes/admin/dashboard.functions.ts");
  assert.match(admin, /viewMerchantSensitiveData/);
  assert.match(admin, /requireAdminForUserId/);
  assert.match(admin, /requireFreshSession/);
  assert.match(admin, /businessNumber: string|businessNumber/);
  assert.match(admin, /decryptMerchantSensitiveData/);
  assert.match(admin, /record_audit_event/);
});


test("new merchant listings have an explicit admin moderation lifecycle", async () => {
  const migration = await read("migrations/0057_product_moderation.sql");
  const moderation = await read("src/routes/admin/moderation.functions.ts");
  assert.match(migration, /admin_set_product_status/);
  assert.match(migration, /action.*approve/);
  assert.match(moderation, /moderateProduct/);
  assert.match(moderation, /requireAdminForUserId/);
});

test("production startup refuses to run without merchant data encryption", async () => {
  const startup = await read("scripts/validate-startup-env.mjs");
  assert.match(startup, /ELEMARKET_MERCHANT_DATA_ENCRYPTION_KEY/);
  assert.match(startup, /exactly 32 bytes/);
});
