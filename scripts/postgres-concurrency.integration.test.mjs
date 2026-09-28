import { createPaymentFixture } from "./helpers/payment-fixture.mjs";
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
const connectionString = process.env.ELEMARKET_INTEGRATION_DATABASE_URL || process.env.DATABASE_URL;
const enabled = process.env.RUN_DB_INTEGRATION === "1" && Boolean(connectionString);

let pool;
let Pool;
let ids;

const maybe = (name, fn) => test(name, { skip: !enabled ? "set RUN_DB_INTEGRATION=1 and ELEMARKET_INTEGRATION_DATABASE_URL/DATABASE_URL" : false }, fn);

async function query(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows;
}

async function cleanup() {
  if (!ids) return;
  // Immutable financial evidence is intentionally retained in this disposable test DB.
  // Each fixture has unique IDs; production evidence must never be deleted for cleanup.
  if ((await query(`select 1 from payment_provider_evidence where payment_id=$1`, [ids.payment])).length) return;

  // The concurrency tests can transition the payment to completed, which
  // creates escrow/ledger records through the payment trigger. Clean up the
  // dependency graph from the leaves inward so PostgreSQL FK restrictions are
  // respected.
  await query(
    `delete from payment_webhook_events where provider_key = $1`,
    [ids.provider],
  );

  await query(
    `delete from merchant_settlements
      where escrow_id in (select id from escrows where order_id = $1)`,
    [ids.order],
  );

  await query(
    `delete from escrow_disputes
      where escrow_id in (select id from escrows where order_id = $1)`,
    [ids.order],
  );

  await query(
    `delete from escrow_ledger_entries
      where escrow_id in (select id from escrows where order_id = $1)`,
    [ids.order],
  );

  await query(
    `delete from escrows where order_id = $1`,
    [ids.order],
  );

  await query(
    `delete from reviews where order_id = $1`,
    [ids.order],
  );

  await query(
    `delete from order_stock_reservations where order_id = $1`,
    [ids.order],
  );

  await query(
    `delete from order_items where order_id = $1`,
    [ids.order],
  );

  await query(
    `delete from payments where id = $1`,
    [ids.payment],
  );

  await query(
    `delete from orders where id = $1`,
    [ids.order],
  );

  await query(
    `delete from order_idempotency where idem = $1`,
    [ids.idem],
  );

  await query(
    `delete from order_groups where id = $1`,
    [ids.group],
  );

  await query(
    `delete from product_variants where id = $1`,
    [ids.variant],
  );

  await query(
    `delete from products where id = $1`,
    [ids.product],
  );

  await query(
    `delete from delivery_quotes where id = $1`,
    [ids.quote],
  );

  await query(
    `delete from "user" where id = $1`,
    [ids.user],
  );

  await query(
    `delete from payment_providers where id = $1`,
    [ids.provider],
  );

  await query(
    `delete from merchants where id = $1`,
    [ids.merchant],
  );
}

before(async () => {
  if (!enabled) return;
  ({ Pool } = await import("pg"));
  pool = new Pool({ connectionString, max: 12, application_name: "elemarket-concurrency-integration" });
  await query("select 1");
  ids = await createPaymentFixture(query);
});

after(async () => {
  if (!enabled) return;
  await cleanup();
  await pool.end();
});

maybe("concurrent payment-attempt allocation is idempotent under a single-open-attempt policy", async () => {
  const clients = await Promise.all(Array.from({ length: 8 }, () => pool.connect()));
  try {
    const results = await Promise.all(clients.map((client) =>
      client.query(
        `select create_payment_attempt($1::text,$2::text,$3::numeric,$4::text,$5::jsonb) as result`,
        [ids.payment, ids.provider, 100, "GHS", JSON.stringify({ integration: true })],
      ).then((r) => r.rows[0].result),
    ));

    // The current production contract permits only one open payment attempt
    // per payment. Concurrent callers must therefore converge on the same
    // attempt rather than allocating attempt numbers 1..8.
    assert.deepEqual(results.map((r) => r.attemptNo), Array(8).fill(1));
    assert.equal(results.filter((r) => r.existing === true).length, 7);
    assert.equal(results.filter((r) => r.existing !== true).length, 1);

    const attempts = await query(
      `select attempt_no, status from payment_attempts where payment_id=$1 order by attempt_no`,
      [ids.payment],
    );
    assert.deepEqual(attempts, [{ attempt_no: 1, status: "initiated" }]);
  } finally {
    clients.forEach((client) => client.release());
  }
});

maybe("duplicate webhook delivery has one business effect", async () => {
  const providerReference = `ref_${ids.payment}`;
  await query(
    `update payment_attempts
        set provider_reference = $1,
            status = 'initiated'
      where id = (
        select id from payment_attempts
         where payment_id = $2
         order by attempt_no desc
         limit 1
      )`,
    [providerReference, ids.payment],
  );

  await query(
    `update payments
        set provider_reference = $1
      where id = $2`,
    [providerReference, ids.payment],
  );
  const payloadHash = "a".repeat(64);
  const clients = await Promise.all(Array.from({ length: 8 }, () => pool.connect()));
  try {
    const results = await Promise.all(clients.map((client) =>
      client.query(
        `select apply_payment_webhook($1::text,$2::text,$3::text,$4::text,$5::text,$6::numeric,$7::text,$8::text) as result`,
        [ids.provider, ids.event, "payment.completed", providerReference, "completed", 100, "GHS", payloadHash],
      ).then((r) => r.rows[0].result),
    ));
    const [payment] = await query(`select status from payments where id=$1`, [ids.payment]);
    const [order] = await query(`select status from orders where id=$1`, [ids.order]);
    const reservations = await query(`select status,count(*)::int as count from order_stock_reservations where order_id=$1 group by status`, [ids.order]);
    const processed = results.filter((r) => r.duplicate !== true);
    assert.equal(processed.length, 1);
    assert.equal(payment.status, "completed");
    assert.equal(order.status, "paid");
    assert.equal(reservations.find((r) => r.status === "consumed")?.count, 1);
  } finally {
    clients.forEach((client) => client.release());
  }
});

maybe("release_order_stock is idempotent under concurrent cancellation", async () => {
  await query(
    `update payments
        set status = 'initiated'
      where id = $1`,
    [ids.payment],
  );

  await query(
    `update orders
        set status = 'payment_pending',
            payment_deadline = now() + interval '15 minutes'
      where id = $1`,
    [ids.order],
  );

  // This test exercises cancellation after payment initialization has ceased.
  // The first concurrency test intentionally creates multiple attempts; close
  // those attempts here so the 0071 cancellation guard is not triggered by
  // state left over from a previous test.
  await query(
    `update payment_attempts
        set status = 'failed',
            updated_at = now()
      where payment_id = $1
        and status in ('initiated','pending','authorized')`,
    [ids.payment],
  );

  await query(
    `update order_stock_reservations
        set status = 'reserved'
      where order_id = $1`,
    [ids.order],
  );

  await query(
    `update product_variants
        set stock = 0
      where id = $1`,
    [ids.variant],
  );
  const clients = await Promise.all([pool.connect(), pool.connect()]);
  try {
    const calls = clients.map((client) => client.query("select set_config('app.user_id',$1,true), release_order_stock($2,$1)", [ids.user, ids.order]));
    await Promise.all(calls);
    const [stock] = await query(`select stock from product_variants where id=$1`, [ids.variant]);
    const [reservation] = await query(`select status from order_stock_reservations where order_id=$1`, [ids.order]);
    const [order] = await query(`select status from orders where id=$1`, [ids.order]);
    assert.equal(stock.stock, 1);
    assert.equal(reservation.status, "released");
    assert.equal(order.status, "cancelled");
  } finally {
    clients.forEach((client) => client.release());
  }
});

maybe("expiry and payment completion race resolves to one coherent terminal outcome", async () => {
  await query(
    `update payments
        set status = 'initiated'
      where id = $1`,
    [ids.payment],
  );

  await query(
    `update payment_attempts
        set status = 'failed', provider_reference = null, updated_at = now()
      where payment_id = $1`,
    [ids.payment],
  );



  await query(
    `update orders
        set status = 'payment_pending',
            payment_deadline = now() - interval '1 second'
      where id = $1`,
    [ids.order],
  );

  await query(
    `update order_stock_reservations
        set status = 'reserved'
      where order_id = $1`,
    [ids.order],
  );

  await query(
    `update product_variants
        set stock = 0
      where id = $1`,
    [ids.variant],
  );
  await query(`delete from payment_webhook_events where provider_key=$1 and event_id=$2`, [ids.provider, ids.event]);
  const raceReference = `race_${ids.payment}`;
  await query(
    `update payment_attempts
        set provider_reference = $1, status = 'initiated', updated_at = now()
      where id = (
        select id from payment_attempts
         where payment_id = $2
         order by attempt_no desc
         limit 1
      )`,
    [raceReference, ids.payment],
  );
  const payloadHash = "b".repeat(64);
  const expiry = pool.query(`select expire_payment_pending_orders(100) as count`);
  const webhook = pool.query(`select apply_payment_webhook($1::text,$2::text,$3::text,$4::text,$5::text,$6::numeric,$7::text,$8::text) as result`, [ids.provider, ids.event, "payment.completed", raceReference, "completed", 100, "GHS", payloadHash]);
  const outcomes = await Promise.allSettled([expiry, webhook]);
  assert.ok(
    outcomes.every((outcome) => outcome.status === 'fulfilled'),
    `terminal-state race should resolve without loser exceptions: ${JSON.stringify(outcomes)}`
  );
  const [payment] = await query(`select status from payments where id=$1`, [ids.payment]);
  const [order] = await query(`select status from orders where id=$1`, [ids.order]);
  const [reservation] = await query(`select status from order_stock_reservations where order_id=$1`, [ids.order]);
  const [variant] = await query(`select stock from product_variants where id=$1`, [ids.variant]);
  const coherentPaid = payment.status === "completed" && order.status === "paid" && reservation.status === "consumed" && variant.stock === 0;
  const coherentCancelled = payment.status === "completed" && order.status === "cancelled" && reservation.status === "released" && variant.stock === 1;
  if (coherentCancelled) {
    const cases = await query(`select id from marketplace_reconciliation_cases where dedupe_key=$1`, [`late-payment:${ids.payment}`]);
    assert.equal(cases.length, 1, "expired paid order must have one reconciliation case");
  }
  assert.ok(coherentPaid || coherentCancelled, `race produced inconsistent state: ${JSON.stringify({ outcomes, payment, order, reservation, variant })}`);
});
