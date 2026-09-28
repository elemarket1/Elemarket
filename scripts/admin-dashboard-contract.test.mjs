import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file) => fs.readFileSync(file, "utf8");

const server = read("src/routes/admin/dashboard.functions.ts");
const page = read("src/routes/admin/dashboard.tsx");
const review = read("src/routes/admin/merchant-review.functions.ts");

test("admin dashboard is server-gated and uses valid payment attempt states", () => {
  assert.match(server, /authMiddleware/);
  assert.match(server, /requireAdminForUserId/);
  assert.match(server, /payment_attempts/);
  assert.match(server, /initiated','pending','authorized/);
  assert.doesNotMatch(server, /orders where status='payment_pending'/);
});

test("admin dashboard exposes merchant review, payments, disputes and audit data", () => {
  for (const token of [
    "merchantReviews",
    "paymentExceptions",
    "refundRequests",
    "auditEvents",
    "merchant_verification_checks",
    "provider_refund_requests",
    "audit_events",
  ]) assert.match(server, new RegExp(token));
});

test("admin UI surfaces controlled merchant review actions", () => {
  assert.match(page, /reviewMerchantApplication/);
  assert.match(page, /start_review/);
  assert.match(page, /approve/);
  assert.match(page, /reject/);
  assert.match(page, /rejection reason/i);
  assert.match(review, /requireFreshSession/);
  assert.match(server, /requestAdminProviderRefund/);
  assert.match(server, /requireFreshSession/);
  assert.match(review, /requireAdminForUserId/);
});

test("admin page does not import server-only authorization modules", () => {
  assert.doesNotMatch(page, /authorization\.server|verify\.server|@tanstack\/react-start\/server/);
});

test("admin errors do not expose server exception text to unauthorized visitors", () => {
  assert.doesNotMatch(page, /error instanceof Error \? error\.message/);
});


test("admin provider refund requests are actor-gated and provider-executed", () => {
  const migration = read("migrations/0041_admin_dispute_audit_atomic.sql");
  assert.match(migration, /perform record_audit_event/);
  assert.match(migration, /p_admin_id/);
  assert.match(migration, /p_resolution/);
});
