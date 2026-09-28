import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../migrations/0103_support_chat_deep_hardening.sql", import.meta.url), "utf8");

test("support chat deep hardening enables pgcrypto before digest usage", () => {
  const extensionPos = migration.indexOf("create extension if not exists pgcrypto;");
  const digestPos = migration.indexOf("v_hash := encode(digest");
  assert.ok(extensionPos >= 0, "0103 must explicitly enable pgcrypto");
  assert.ok(digestPos >= 0, "0103 must retain digest-based request hashing");
  assert.ok(extensionPos < digestPos, "pgcrypto must be enabled before the first digest call");
});
