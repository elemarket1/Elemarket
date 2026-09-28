import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("v1.38 metadata is synchronized", () => {
  const pkg = JSON.parse(read("package.json"));
  const lock = JSON.parse(read("package-lock.json"));
  assert.equal(pkg.version, lock.packages[""].version);
  assert.match(pkg.version, /^1\.\d+\.\d+$/);
});

test("reservation release and expiry share an order-scoped concurrency lock", () => {
  const sql = read("migrations/0016_concurrency_payment_integrity.sql");
  assert.match(sql, /create or replace function release_order_stock/);
  assert.match(sql, /pg_advisory_xact_lock\(hashtext\('elemarket:order:' \|\| p_order_id\)\)/);
  assert.match(sql, /create or replace function expire_payment_pending_orders/);
  assert.match(sql, /for update skip locked/i);
  assert.match(sql, /status = 'payment_pending'/);
});

test("payment completion cannot race reservation release", () => {
  const sql = read("migrations/0016_concurrency_payment_integrity.sql");
  const lock = sql.indexOf("elemarket:order:' || v_payment.order_id");
  const order = sql.indexOf("select * into v_order from orders where id = v_payment.order_id for update");
  assert.ok(lock >= 0 && order > lock, "webhook must acquire the order lock before locking the order row");
  assert.match(sql, /reservation integrity failure/);
});

test("webhook duplicate delivery is atomically claimed", () => {
  const sql = read("migrations/0016_concurrency_payment_integrity.sql");
  assert.match(sql, /on conflict \(provider_key,event_id\) do nothing/i);
  assert.match(sql, /processing_status in \('processed','ignored','rejected'\)/);
  assert.match(sql, /event_payload_mismatch/);
});

test("payment state machine rejects illegal regressions", () => {
  const sql = read("migrations/0016_concurrency_payment_integrity.sql");
  assert.match(sql, /create or replace function validate_payment_transition/);
  assert.match(sql, /when 'completed' then p_to in \('completed','refunded'\)/);
  assert.match(sql, /when 'failed' then p_to = 'failed'/);
  assert.match(sql, /invalid_state_transition/);
});

test("payment attempt numbering is allocated atomically in the database", () => {
  const sql = read("migrations/0016_concurrency_payment_integrity.sql");
  const src = read("src/lib/market/payment.server.ts");
  assert.match(sql, /create or replace function create_payment_attempt/);
  assert.match(sql, /hashtext\('elemarket:payment-attempt:' \|\| p_payment_id\)/);
  const paymentSql = read("migrations/0012_payment_orchestration.sql");
  assert.match(paymentSql, /unique\(payment_id, attempt_no\)/i);
  assert.match(src, /create_payment_attempt/);
  assert.doesNotMatch(src, /select coalesce\(max\(attempt_no\),0\) \+ 1 as next_attempt/);
});

test("webhook requires an active provider and explicit provider reference", () => {
  const sql = read("migrations/0016_concurrency_payment_integrity.sql");
  assert.match(sql, /v_provider.status <> 'active'/);
  assert.match(sql, /p\.provider_reference is not null/);
  assert.match(sql, /payment_not_found/);
});


test("v1.38 uses 64-bit advisory lock keys without mutating 0016 history", () => {
  const oldSql = read("migrations/0016_concurrency_payment_integrity.sql");
  const newSql = read("migrations/0017_extended_advisory_lock_hardening.sql");
  assert.match(oldSql, /hashtext\('elemarket:order:' \|\| p_order_id\)/);
  assert.match(newSql, /hashtextextended\('elemarket:order:' \|\| p_order_id, 0\)/);
  assert.match(newSql, /hashtextextended\('elemarket:payment-attempt:' \|\| p_payment_id, 0\)/);
});

test("database concurrency integration harness is shipped", () => {
  const src = read("scripts/postgres-concurrency.integration.test.mjs");
  assert.match(src, /RUN_DB_INTEGRATION/);
  assert.match(src, /concurrent payment-attempt allocation/);
  assert.match(src, /duplicate webhook delivery/);
  assert.match(src, /expiry and payment completion race/);
});
