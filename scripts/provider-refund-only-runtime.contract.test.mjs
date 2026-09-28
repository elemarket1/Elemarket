import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const sourceFiles = [
  "src/routes/admin/dashboard.functions.ts",
  "src/routes/admin/dashboard.tsx",
  "src/lib/market/merchant-finance.server.ts",
  "src/lib/market/provider-refunds.server.ts",
  "src/lib/storage/storage.server.ts",
  "src/routes/merchant/dashboard.tsx",
];

test("live application paths contain no escrow dependency", () => {
  for (const file of sourceFiles) {
    const source = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(source, /escrow|Escrow|ESCROW/);
  }
});

test("admin refund operations use provider refund records", () => {
  const server = fs.readFileSync("src/routes/admin/dashboard.functions.ts", "utf8");
  assert.match(server, /provider_refund_requests/);
  assert.match(server, /prepare_provider_refund_for_payment/);
  assert.match(server, /requestAdminProviderRefund/);
  assert.match(server, /prepare_provider_refund_for_dispute/);
  assert.match(server, /customer_order_disputes/);
  assert.doesNotMatch(server, /escrow_disputes/);
});

test("merchant finance reads provider refund operations only", () => {
  const source = fs.readFileSync("src/lib/market/merchant-finance.server.ts", "utf8");
  assert.match(source, /provider_refund_requests/);
  assert.doesNotMatch(source, /escrow_disputes|merchant_settlements|release_escrow/);
});

test("storage refund evidence is ownership-scoped to provider refund requests", () => {
  const source = fs.readFileSync("src/lib/storage/storage.server.ts", "utf8");
  assert.match(source, /refund-evidence/);
  assert.match(source, /provider_refund_requests/);
  assert.doesNotMatch(source, /escrow_disputes/);
});

test("provider-refund runtime migration adds operational indexing without deleting historical migrations", () => {
  const migration = fs.readFileSync("migrations/0089_provider_refund_only_runtime.sql", "utf8");
  assert.match(migration, /provider_refund_requests_status_idx/);
  assert.match(migration, /LIVE provider-managed refund operations/);
  assert.doesNotMatch(migration, /drop table.*escrow/i);
});
