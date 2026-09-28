import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("FCM adapter uses server-only Firebase service-account credentials", () => {
  const source = read("src/lib/notifications/push/providers/fcm.server.ts");
  assert.match(source, /FCM_SERVICE_ACCOUNT_JSON/);
  assert.match(source, /googleapis\.com\/token/);
  assert.match(source, /fcm\.googleapis\.com\/v1\/projects/);
  assert.doesNotMatch(source, /VITE_FCM/);
});

test("push device registration is authenticated and token-bound", () => {
  const source = read("src/routes/push.functions.ts");
  assert.match(source, /middleware\(\[authMiddleware\]\)/);
  assert.match(source, /registerPushDevice/);
  assert.match(source, /unregisterPushDevice/);
});

test("push devices are scoped to users and token hashes", () => {
  const sql = read("migrations/0045_push_notifications_fcm.sql");
  assert.match(sql, /user_id text not null references "user"/);
  assert.match(sql, /token_hash text not null unique/);
  assert.match(sql, /on delete cascade/);
});

test("FCM defaults are fail-closed in production", () => {
  const source = read("scripts/validate-startup-env.mjs");
  assert.match(source, /ELEMARKET_PUSH_PROVIDER/);
  assert.match(source, /FCM_SERVICE_ACCOUNT_JSON/);
  assert.match(source, /project_id.*client_email.*private_key/);
});

test("push delivery disables terminally invalid device tokens", () => {
  const source = read("src/lib/notifications/push/push.server.ts");
  assert.match(source, /UNREGISTERED/);
  assert.match(source, /INVALID_ARGUMENT/);
  assert.match(source, /disabled_at = case when \$3 then now\(\)/);
});


test("FCM delivery retries transient provider failures with bounded backoff", () => {
  const source = read("src/lib/notifications/push/providers/fcm.server.ts");
  assert.match(source, /MAX_RETRIES/);
  assert.match(source, /response\.status === 429 \|\| response\.status >= 500/);
  assert.match(source, /2 \*\* attempt/);
});
