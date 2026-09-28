import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const auth = fs.readFileSync("src/lib/security/internal-job-auth.server.ts", "utf8");
const order = fs.readFileSync("src/routes/api.internal.enterprise-order-outbox.ts", "utf8");
const webhook = fs.readFileSync("src/routes/api.internal.enterprise-webhook-worker.ts", "utf8");
const cronExpire = fs.readFileSync("src/routes/api.internal.expire-payment-orders.ts", "utf8");
const cronSync = fs.readFileSync("src/routes/api.internal.sync-enterprise-catalogs.ts", "utf8");

test("internal enterprise workers require timestamp-bound HMAC proofs", () => {
  assert.match(auth, /createHmac\("sha256"/);
  assert.match(auth, /MAX_SKEW_MS/);
  assert.match(auth, /request\.method\.toUpperCase\(\)/);
  assert.match(auth, /new URL\(request\.url\)\.pathname/);
  assert.match(order, /authorizeInternalHmacRequest/);
  assert.match(webhook, /authorizeInternalHmacRequest/);
  assert.doesNotMatch(order, /x-elemarket-sync-secret/);
  assert.doesNotMatch(webhook, /x-elemarket-sync-secret/);
});

test("expensive internal cron jobs have bounded request-rate controls", () => {
  assert.match(cronExpire, /enforceRateLimit/);
  assert.match(cronSync, /enforceRateLimit/);
});

test("Vercel Cron transport accepts only the documented Bearer secret form", () => {
  assert.match(auth, /authorization/);
  assert.match(auth, /Bearer \${cronSecret\?\.trim\(\)}/);
  for (const route of [cronExpire, cronSync]) assert.match(route, /process\.env\.CRON_SECRET\)/);
  for (const route of [order, webhook]) assert.doesNotMatch(route, /process\.env\.CRON_SECRET\)/);
  assert.match(auth, /vercel-cron\/1\.0/);
  assert.match(auth, /request\.method\.toUpperCase\(\) === "GET"/);
});
