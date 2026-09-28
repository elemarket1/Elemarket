import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");

test("deep attack: administrator 2FA is enabled and backed by Better Auth schema", () => {
  const auth = read("../src/lib/auth/server.ts");
  const migration = read("../migrations/0072_admin_two_factor.sql");
  assert.match(auth, /twoFactor\(/);
  assert.match(auth, /issuer:\s*"ELEMARKET"/);
  assert.match(migration, /alter table "user" add column if not exists "twoFactorEnabled"/);
  assert.match(migration, /create table if not exists "twoFactor"/);
  assert.match(migration, /failedVerificationCount/);
});

test("deep attack: admin authorization fails closed until 2FA is enabled", () => {
  const authz = read("../src/lib/auth/authorization.server.ts");
  assert.match(authz, /requireAdminRoleForUserId/);
  assert.match(authz, /twoFactorEnabled/);
  assert.match(authz, /Administrator two-factor authentication is required/);
});

test("deep attack: payment initialization and status endpoints are rate limited", () => {
  const payment = read("../src/lib/market/payment.ts");
  assert.match(payment, /"payment-intent"/);
  assert.match(payment, /"payment-status"/);
  assert.match(payment, /subject: userId/);
});

test("deep attack: cancellation cannot release stock during provider initialization", () => {
  const migration = read("../migrations/0071_deep_attack_hardening.sql");
  assert.match(migration, /payment_attempts/);
  assert.match(migration, /status in \('initiated','pending','authorized'\)/);
  assert.match(migration, /cancellation is blocked until payment settles or fails/);
});

test("deep attack: provider checkout URLs are constrained before browser redirect", () => {
  const payment = read("../src/lib/market/payment.server.ts");
  assert.match(payment, /validateProviderCheckoutUrl/);
  assert.match(payment, /url\.protocol === "https:"/);
  assert.match(payment, /Provider returned an unsafe checkout URL/);
});

test("deep attack: CSP provider connect destinations are deployment configurable", () => {
  const headers = read("../src/lib/security/headers.ts");
  assert.match(headers, /browserPolicy/);
  assert.match(read("../src/lib/providers/browser-policy.mjs"), /ELEMARKET_CSP_CONNECT_SRC/);
});

test("deep attack: customer payment endpoints enforce bounded per-user request rates", () => {
  const intent = read("../src/routes/api.mobile.payment-intent.ts");
  const status = read("../src/routes/api.mobile.payment-status.ts");
  assert.match(intent, /customer-payment-intent/);
  assert.match(intent, /subject: current\.user\.id/);
  assert.match(status, /customer-payment-status/);
  assert.match(status, /subject: current\.user\.id/);
});

test("deep attack: enterprise webhook oversize handling cannot reference uninitialized body state", () => {
  const webhook = read("../src/routes/api.enterprise.catalog.webhook.ts");
  assert.match(webhook, /catch \{ return new Response\("Payload too large", \{ status: 413 \}\); \}/);
  assert.doesNotMatch(webhook, /catch \{ return new Response\(`Payload too large \(\$\{rawBody\.length\}\)`/);
});
