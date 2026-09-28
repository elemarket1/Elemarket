import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const root = new URL("..", import.meta.url).pathname;
const migration = fs.readFileSync(new URL("../migrations/0074_admin_provider_adapter_hardening.sql", import.meta.url), "utf8");
const admin = fs.readFileSync(new URL("../src/routes/admin/moderation.functions.ts", import.meta.url), "utf8");
const registry = fs.readFileSync(new URL("../src/lib/market/adapters/registry.ts", import.meta.url), "utf8");
const payment = fs.readFileSync(new URL("../src/lib/market/payment.server.ts", import.meta.url), "utf8");
const paystack = fs.readFileSync(new URL("../src/lib/market/adapters/providers/paystack.ts", import.meta.url), "utf8");

test("enterprise admin mode preserves authenticated admin identity", () => {
  assert.match(migration, /admin_set_merchant_enterprise_mode\(\s*p_merchant_id text,\s*p_admin_id text,\s*p_enabled boolean,\s*p_reason text/s);
  assert.match(migration, /p_admin_id is null/);
  assert.match(migration, /record_audit_event\(/);
  assert.match(migration, /p_admin_id,\s*\n\s*'admin'/);
  assert.match(admin, /admin_set_merchant_enterprise_mode\(\$1,\$2,\$3,\$4\)/);
});

test("provider registry keeps dynamic drivers explicitly allowlisted", () => {
  assert.match(registry, /ELEMARKET_PAYMENT_ALLOWED_MODULES/);
  assert.match(registry, /allowedModules\.includes\(moduleSpecifier\)/);
});

test("payment server revalidates provider checkout URLs before returning them", () => {
  assert.match(payment, /validateProviderCheckoutUrl/);
  assert.match(payment, /url\.protocol === "https:"/);
  assert.match(payment, /url\.username \|\| url\.password \|\| url\.hash/);
  assert.match(payment, /getPaymentAdapter/);
});

test("Paystack adapter uses server-side credentials and idempotency", () => {
  assert.match(paystack, /authorization:`Bearer \$\{this\.secret\}`/);
  assert.match(paystack, /idempotency-key/);
  assert.doesNotMatch(paystack, /localStorage|sessionStorage|document\.cookie/);
});
