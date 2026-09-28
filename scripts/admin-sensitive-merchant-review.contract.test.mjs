import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const admin = await readFile(new URL("../src/routes/admin/dashboard.functions.ts", import.meta.url), "utf8");
const sensitive = await readFile(new URL("../src/lib/security/merchant-sensitive.server.ts", import.meta.url), "utf8");

test("admin sensitive merchant verification remains an explicit server-side reveal", () => {
  assert.match(admin, /viewMerchantSensitiveData/);
  assert.match(admin, /requireAdminForUserId/);
  assert.match(admin, /taxpayer_id_encrypted/);
  assert.match(admin, /decryptMerchantSensitiveData/);
  assert.match(sensitive, /aes-256-gcm/);
});
