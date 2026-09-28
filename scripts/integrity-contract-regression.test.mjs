import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("v1.39 lock ordering is advisory -> order row -> reservations", () => {
  const sql = read("migrations/0018_deadlock_reservation_integrity.sql");
  const releaseLock = sql.indexOf("hashtextextended('elemarket:order:' || p_order_id, 0)");
  const releaseOrder = sql.indexOf("from orders\n   where id = p_order_id\n   for update", releaseLock);
  const releaseReservations = sql.indexOf("from order_stock_reservations", releaseOrder);
  assert.ok(releaseLock >= 0 && releaseOrder > releaseLock && releaseReservations > releaseOrder);

  const expiryLock = sql.indexOf("hashtextextended('elemarket:order:' || r.id, 0)");
  const expiryOrder = sql.indexOf("from orders\n     where id = r.id\n     for update", expiryLock);
  const expiryReservations = sql.indexOf("from order_stock_reservations", expiryOrder);
  assert.ok(expiryLock >= 0 && expiryOrder > expiryLock && expiryReservations > expiryOrder);
});

test("v1.39 removes expiry SKIP LOCKED before advisory lock", () => {
  const sql = read("migrations/0018_deadlock_reservation_integrity.sql");
  const expiry = sql.slice(sql.indexOf("create or replace function expire_payment_pending_orders"), sql.indexOf("-- Upgrade the checkout user lock"));
  assert.doesNotMatch(expiry, /for update skip locked/i);
  assert.match(expiry, /Do not lock the order row before acquiring the advisory lock/i);
});

test("v1.39 database validates reservation against its exact order item", () => {
  const sql = read("migrations/0018_deadlock_reservation_integrity.sql");
  assert.match(sql, /create or replace function validate_reservation_integrity/i);
  assert.match(sql, /v_item\.order_id <> new\.order_id/);
  assert.match(sql, /v_item\.product_id <> new\.product_id/);
  assert.match(sql, /v_item\.quantity <> new\.quantity/);
  assert.match(sql, /coalesce\(v_item\.variant_id, ''\) <> coalesce\(new\.variant_id, ''\)/);
  assert.match(sql, /create trigger order_stock_reservation_integrity_validate/i);
});

test("v1.39 checkout user lock uses the 64-bit advisory primitive", () => {
  const sql = read("migrations/0018_deadlock_reservation_integrity.sql");
  assert.match(sql, /hashtextextended\('elemarket:checkout:' \|\| p_user_id, 0\)/);
});
