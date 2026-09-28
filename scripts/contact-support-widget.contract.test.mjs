import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const widget = readFileSync(new URL("../src/components/contact-support-widget.tsx", import.meta.url), "utf8");
const home = readFileSync(new URL("../src/routes/index.tsx", import.meta.url), "utf8");
const cart = readFileSync(new URL("../src/routes/cart.tsx", import.meta.url), "utf8");
const checkout = readFileSync(new URL("../src/routes/checkout.tsx", import.meta.url), "utf8");

test("contact widget is intentionally quiet and opt-in", () => {
  assert.match(widget, /fixed bottom-4 right-4/);
  assert.match(widget, /onClick=\{\(\) => setOpen\(true\)\}/);
  assert.doesNotMatch(widget, /animate-/);
  assert.doesNotMatch(widget, /autoOpen|setTimeout\(.*open/);
});

test("homepage opts into Contact Us while cart and checkout use Order Support", () => {
  assert.match(home, /<ContactSupportWidget \/>/);
  assert.match(cart, /<ContactSupportWidget mode="order" \/>/);
  assert.match(checkout, /<ContactSupportWidget mode="order" \/>/);
});

test("support contact destinations are deployment-configured", () => {
  assert.match(widget, /VITE_ELEMARKET_SUPPORT_EMAIL/);
  assert.match(widget, /VITE_ELEMARKET_SUPPORT_PHONE/);
  assert.match(widget, /VITE_ELEMARKET_SUPPORT_WHATSAPP/);
});

test("support chat has server-side ownership and idempotency boundaries", () => {
  const functions = readFileSync(new URL("../src/lib/support.functions.ts", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../migrations/0102_support_chat.sql", import.meta.url), "utf8");
  const admin = readFileSync(new URL("../src/lib/admin-support.functions.ts", import.meta.url), "utf8");
  assert.match(functions, /requireCustomerForUserId\(userId\)/);
  assert.match(functions, /append_customer_support_message/);
  assert.match(migration, /customer_id text not null/);
  assert.match(migration, /support_messages_sender_idempotency_uq/);
  assert.match(migration, /p_order_id is not null/);
  assert.match(admin, /requireAdminCapability\("read_support", adminId\)/);
  assert.match(admin, /sender_type.*support/);
});

test("order support carries a server-validated order context", () => {
  const support = readFileSync(new URL("../src/routes/support.tsx", import.meta.url), "utf8");
  const orderDetail = readFileSync(new URL("../src/routes/orders.$id.tsx", import.meta.url), "utf8");
  assert.match(support, /URLSearchParams\(window\.location\.search\)/);
  assert.match(support, /orderId/);
  assert.match(orderDetail, /\/support\?orderId=\$\{encodeURIComponent\(id\)\}/);
});

test("support idempotency rejects key reuse with a different message body", () => {
  const migration = readFileSync(new URL("../migrations/0103_support_chat_deep_hardening.sql", import.meta.url), "utf8");
  assert.match(migration, /request_hash/);
  assert.match(migration, /idempotency key reuse with different message/);
  assert.match(migration, /append_support_agent_message/);
  assert.match(migration, /pg_advisory_xact_lock/);
});
