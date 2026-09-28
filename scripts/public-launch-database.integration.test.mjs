import test, { after } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { createPaymentFixture } from "./helpers/payment-fixture.mjs";
import { loadTypeScript } from "./helpers/load-typescript.mjs";
const enabled =
  process.env.RUN_DB_INTEGRATION === "1" &&
  Boolean(process.env.ELEMARKET_INTEGRATION_DATABASE_URL || process.env.DATABASE_URL);
const pool = enabled
  ? new Pool({
      connectionString: process.env.ELEMARKET_INTEGRATION_DATABASE_URL || process.env.DATABASE_URL,
    })
  : null;
after(async () => {
  await pool?.end();
});
function integration(name, fn) {
  test(
    name,
    { skip: !enabled ? "PostgreSQL integration environment required" : false },
    async () => {
      const client = await pool.connect();
      await client.query("BEGIN");
      const query = async (s, p) => (await client.query(s, p)).rows;
      try {
        await fn(query, client);
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    },
  );
}
async function rejectsSql(client, operation, pattern) {
  await client.query("SAVEPOINT rejection");
  await assert.rejects(operation, pattern);
  await client.query("ROLLBACK TO SAVEPOINT rejection");
}
async function payment(query) {
  const ids = await createPaymentFixture(query);
  await query(`select create_payment_attempt($1,$2,100,'GHS','{}'::jsonb)`, [
    ids.payment,
    ids.provider,
  ]);
  ids.reference = `ref_${ids.payment}`;
  await query(`update payment_attempts set provider_reference=$1 where payment_id=$2`, [
    ids.reference,
    ids.payment,
  ]);
  return ids;
}
const webhook = (
  query,
  ids,
  event = ids.event,
  amount = 100,
  reference = ids.reference,
  status = "completed",
  type = "charge.success",
) =>
  query(`select apply_payment_webhook($1,$2,$3,$4,$5,$6,'GHS',$7) result`, [
    ids.provider,
    event,
    type,
    reference,
    status,
    amount,
    "a".repeat(64),
  ]).then((r) => r[0].result);

integration(
  "late and repeated successful charges preserve evidence and exactly one reconciliation without restoring inventory or order",
  async (query, client) => {
    const ids = await payment(query);
    await query(`update orders set payment_deadline=now()-interval '1 second' where id=$1`, [
      ids.order,
    ]);
    await query(`select expire_payment_pending_orders(100)`);
    assert.equal((await webhook(query, ids)).reconciliationRequired, true);
    assert.equal((await webhook(query, ids)).duplicate, true);
    await webhook(query, ids, ids.event + "-retry");
    const [state] = await query(
      `select p.status payment,o.status order_status from payments p join orders o on o.id=p.order_id where p.id=$1`,
      [ids.payment],
    );
    assert.deepEqual(state, { payment: "completed", order_status: "cancelled" });
    assert.equal(
      (
        await query(`select id from marketplace_reconciliation_cases where dedupe_key=$1`, [
          `late-payment:${ids.payment}`,
        ])
      ).length,
      1,
    );
    assert.equal(
      (await query(`select id from provider_refund_requests where payment_id=$1`, [ids.payment]))
        .length,
      0,
      "reconciliation must not blindly issue a provider refund",
    );
    assert.equal(
      (await query(`select * from payment_provider_evidence where payment_id=$1`, [ids.payment]))
        .length,
      2,
    );
    await rejectsSql(
      client,
      () =>
        query(`update payment_provider_evidence set amount=1 where payment_id=$1`, [ids.payment]),
      /immutable/,
    );
    assert.equal(
      (await query(`select status from order_stock_reservations where order_id=$1`, [ids.order]))[0]
        .status,
      "released",
    );
  },
);

integration(
  "payment completed before expiry stays paid and has no reconciliation case",
  async (query) => {
    const ids = await payment(query);
    await webhook(query, ids);
    await query(`update orders set payment_deadline=now()-interval '1 second' where id=$1`, [
      ids.order,
    ]);
    await query(`select expire_payment_pending_orders(100)`);
    assert.equal(
      (await query(`select status from orders where id=$1`, [ids.order]))[0].status,
      "paid",
    );
    assert.equal(
      (
        await query(`select id from marketplace_reconciliation_cases where order_id=$1`, [
          ids.order,
        ])
      ).length,
      0,
    );
  },
);

integration(
  "boundary expiry at database now and late success retain a durable resolution",
  async (query) => {
    const ids = await payment(query);
    await query(`update orders set payment_deadline=now() where id=$1`, [ids.order]);
    await query(`select expire_payment_pending_orders(100)`);
    await webhook(query, ids);
    assert.equal(
      (
        await query(`select id from marketplace_reconciliation_cases where order_id=$1`, [
          ids.order,
        ])
      ).length,
      1,
    );
  },
);

integration(
  "mismatched amounts commit rejection evidence and do not alter money state; unknown references are retryable",
  async (query) => {
    const ids = await payment(query);
    assert.equal((await webhook(query, ids, ids.event, 99)).rejected, true);
    assert.equal(
      (
        await query(`select * from payment_webhook_rejections where provider_key=$1`, [
          ids.provider,
        ])
      ).length,
      1,
    );
    assert.equal(
      (await query(`select status from payments where id=$1`, [ids.payment]))[0].status,
      "initiated",
    );
    assert.equal(
      (await query(`select * from payment_provider_evidence where payment_id=$1`, [ids.payment]))
        .length,
      0,
    );
    assert.equal(
      (await webhook(query, ids, ids.event + "-unknown", 100, "unknown-reference")).retryable,
      true,
    );
  },
);

integration("already refunded payment never regresses on a delayed success", async (query) => {
  const ids = await payment(query);
  await webhook(query, ids);
  await query("select prepare_provider_refund_for_payment($1,$2,$3)",[ids.payment,ids.user,"test refund"]);
  await webhook(
    query,
    ids,
    ids.event + "-refund",
    100,
    ids.reference,
    "refunded",
    "refund.processed",
  );
  await webhook(query, ids, ids.event + "-late");
  assert.equal(
    (await query(`select status from payments where id=$1`, [ids.payment]))[0].status,
    "refunded",
  );
  assert.equal(
    (await query(`select id from marketplace_reconciliation_cases where order_id=$1`, [ids.order]))
      .length,
    0,
  );
});

async function phoneFixture(query) {
  const user = `phone_${randomUUID()}`,
    app = `app_${randomUUID()}`,
    challenge = `otp_${randomUUID().replaceAll("-", "")}`;
  const phone = "+23320" + String(Math.floor(Math.random() * 1e7)).padStart(7, "0");
  await query(
    `insert into "user"(id,name,email,"emailVerified") values($1,'Phone audit',$2,true)`,
    [user, `${user}@example.invalid`],
  );
  await query(
    `insert into profiles(user_id,name,phone,address) values($1,'Phone audit',$2,'Audit address')`,
    [user, phone],
  );
  await query(
    `insert into merchant_applications(id,user_id,business_name,category,address,contact,registration_number,taxpayer_id_type,taxpayer_id_encrypted,business_type,tax_registration_status) values($1,$2,'Audit shop','electronics','Audit address',$3,$1,'tin',$4,'limited_company','registered')`,
    [app, user, phone, "synthetic-encrypted-data-for-fixture"],
  );
  await query(
    `insert into otp_challenges(id,user_id,destination,purpose,provider,status,expires_at,cooldown_until,verified_at) values($1,$2,$3,'phone_verification','arkesel','verified',now()+interval '5 minutes',now(),now())`,
    [challenge, user, phone],
  );
  return { user, app, challenge, phone };
}
integration(
  "phone confirmation binds account/profile/application/challenge and cannot be replayed",
  async (query, client) => {
    const ids = await phoneFixture(query);
    await query(`select confirm_phone_verification($1,$2)`, [ids.user, ids.challenge]);
    assert.ok(
      (await query(`select phone_verified_at from profiles where user_id=$1`, [ids.user]))[0]
        .phone_verified_at,
    );
    assert.equal(
      (
        await query(
          `select status from merchant_verification_checks where application_id=$1 and check_type='phone'`,
          [ids.app],
        )
      )[0].status,
      "verified",
    );
    await rejectsSql(
      client,
      () => query(`select confirm_phone_verification($1,$2)`, [ids.user, ids.challenge]),
      /does not match/,
    );
  },
);
integration(
  "wrong OTP owner, profile phone, purpose, and application contact reject atomically",
  async (query, client) => {
    const ids = await phoneFixture(query);
    for (const mutation of [
      [`update otp_challenges set user_id='another-account' where id=$1`, [ids.challenge]],
      [`update otp_challenges set destination='+233501234567' where id=$1`, [ids.challenge]],
      [`update otp_challenges set purpose='login' where id=$1`, [ids.challenge]],
      [`update merchant_applications set contact='+233501234567' where id=$1`, [ids.app]],
    ]) {
      await client.query("SAVEPOINT mutation");
      await query(...mutation);
      await rejectsSql(
        client,
        () => query(`select confirm_phone_verification($1,$2)`, [ids.user, ids.challenge]),
        /does not match/,
      );
      assert.equal(
        (await query(`select phone_verified_at from profiles where user_id=$1`, [ids.user]))[0]
          .phone_verified_at,
        null,
      );
      assert.equal(
        (await query(`select phone_applied_at from otp_challenges where id=$1`, [ids.challenge]))[0]
          .phone_applied_at,
        null,
      );
      await client.query("ROLLBACK TO SAVEPOINT mutation");
    }
  },
);
integration(
  "all SQL phone mutations including removal invalidate verification; same canonical number preserves it",
  async (query) => {
    const ids = await phoneFixture(query);
    await query(`select confirm_phone_verification($1,$2)`, [ids.user, ids.challenge]);
    await query(`update profiles set phone=$2 where user_id=$1`, [ids.user, ids.phone]);
    assert.ok(
      (await query(`select phone_verified_at from profiles where user_id=$1`, [ids.user]))[0]
        .phone_verified_at,
    );
    await query(
      `update profiles set phone='+233501234567',phone_verified_at=now() where user_id=$1`,
      [ids.user],
    );
    assert.equal(
      (await query(`select phone_verified_at from profiles where user_id=$1`, [ids.user]))[0]
        .phone_verified_at,
      null,
    );
    assert.equal(
      (
        await query(
          `select status from merchant_verification_checks where application_id=$1 and check_type='phone'`,
          [ids.app],
        )
      )[0].status,
      "pending",
    );
    await query(`update profiles set phone=null,phone_verified_at=now() where user_id=$1`, [
      ids.user,
    ]);
    assert.equal(
      (await query(`select phone_verified_at from profiles where user_id=$1`, [ids.user]))[0]
        .phone_verified_at,
      null,
    );
  },
);
integration(
  "mobile API changing a verified phone clears verification in the actual handler",
  async (query) => {
    const ids = await phoneFixture(query);
    await query(`select confirm_phone_verification($1,$2)`, [ids.user, ids.challenge]);
    const route = loadTypeScript("src/routes/api.mobile.profile.ts", {
      "@tanstack/react-router": { createFileRoute: () => (x) => x },
      "@/lib/db": { getSql: async () => ({ query }) },
      "@/lib/auth/server": {
        auth: { api: { getSession: async () => ({ user: { id: ids.user } }) } },
      },
      "@/lib/security/rate-limit.server": { enforceRateLimit: async () => {} },
      "@/lib/security/body.server": loadTypeScript("src/lib/security/body.server.ts"),
      "@/lib/auth/phone": loadTypeScript("src/lib/auth/phone.ts"),
      "@/lib/auth/isolation.server": { assertSameSiteRequest: () => {} },
    }).Route;
    const response = await route.server.handlers.PUT({
      request: new Request("https://example.test/api/mobile/profile", {
        method: "PUT",
        body: JSON.stringify({
          name: "Phone audit",
          phone: "0501234567",
          address: "Audit address",
        }),
      }),
    });
    assert.equal(response.status, 200);
    const [row] = await query(`select phone,phone_verified_at from profiles where user_id=$1`, [
      ids.user,
    ]);
    assert.deepEqual(row, { phone: "+233501234567", phone_verified_at: null });
  },
);

// These cases use committed synthetic fixtures so separate connections see the same state.
// Their immutable evidence is retained only in the disposable test database.
test(
  "concurrent delayed successes converge on one durable reconciliation",
  { skip: !enabled },
  async () => {
    const query = async (s, p) => (await pool.query(s, p)).rows;
    const ids = await payment(query);
    await query(`update orders set payment_deadline=now()-interval '1 second' where id=$1`, [
      ids.order,
    ]);
    await query(`select expire_payment_pending_orders(100)`);
    await Promise.all(
      Array.from({ length: 8 }, (_, i) => webhook(query, ids, `${ids.event}-${i}`)),
    );
    assert.equal(
      (
        await query(`select id from marketplace_reconciliation_cases where dedupe_key=$1`, [
          `late-payment:${ids.payment}`,
        ])
      ).length,
      1,
    );
    assert.equal(
      (await query(`select id from provider_refund_requests where payment_id=$1`, [ids.payment]))
        .length,
      0,
    );
    assert.equal(
      (await query(`select status from orders where id=$1`, [ids.order]))[0].status,
      "cancelled",
    );
  },
);
test(
  "concurrent profile phone change cannot leave the replacement verified",
  { skip: !enabled },
  async () => {
    const query = async (s, p) => (await pool.query(s, p)).rows;
    const ids = await phoneFixture(query);
    const outcomes = await Promise.allSettled([
      query(`select confirm_phone_verification($1,$2)`, [ids.user, ids.challenge]),
      query(`update profiles set phone='+233509876543' where user_id=$1`, [ids.user]),
    ]);
    assert.equal(outcomes[1].status, "fulfilled");
    const [profile] = await query(`select phone,phone_verified_at from profiles where user_id=$1`, [
      ids.user,
    ]);
    assert.deepEqual(profile, { phone: "+233509876543", phone_verified_at: null });
    assert.equal(
      (
        await query(
          `select status from merchant_verification_checks where application_id=$1 and check_type='phone'`,
          [ids.app],
        )
      )[0].status,
      "pending",
    );
    // Release this fixed synthetic number for subsequent suite runs.
    await query(`update profiles set phone=null where user_id=$1`, [ids.user]);
  },
);

integration(
  "a freshly verified replay of a legacy ignored late charge is reconciled instead of discarded",
  async (query) => {
    const ids = await payment(query);
    await query(`update orders set payment_deadline=now()-interval '1 second' where id=$1`, [
      ids.order,
    ]);
    await query(`select expire_payment_pending_orders(100)`);
    await query(
      `insert into payment_webhook_events(provider_key,event_id,event_type,provider_reference,payload_hash,signature_verified,processing_status,error_code) values($1,$2,'charge.success',$3,$4,true,'ignored','order_already_resolved')`,
      [ids.provider, ids.event, ids.reference, "a".repeat(64)],
    );
    assert.equal((await webhook(query, ids)).reconciliationRequired, true);
    assert.equal(
      (
        await query(`select id from marketplace_reconciliation_cases where dedupe_key=$1`, [
          `late-payment:${ids.payment}`,
        ])
      ).length,
      1,
    );
  },
);

integration(
  "refund timeout cannot dispatch a second refund and a foreign actor cannot retry it",
  async (query) => {
    const ids = await payment(query);
    await webhook(query, ids);
    const [{ result }] = await query(
      `select prepare_provider_refund_for_payment($1,$2,'regression') result`,
      [ids.payment, ids.user],
    );
    let calls = 0;
    let actor = ids.user;
    const refunds = loadTypeScript("src/lib/market/refunds.server.ts", {
      "@/lib/db": { getSql: async () => ({ query }) },
      "@/lib/market/adapters/registry": {
        getPaymentAdapter: async () => ({
          refundPayment: async () => {
            calls++;
            throw new Error("provider timeout");
          },
        }),
      },
      "@/lib/observability/logger.server": { recordMetric: async () => {} },
      "@/lib/auth/verify.server": { requireFreshSession: async () => actor },
      "@/lib/auth/authorization.server": {
        requireAdminForUserId: async () => {
          throw new Error("Not admin");
        },
      },
    });
    await assert.rejects(
      () => refunds.executeProviderRefundAsAuthenticatedUser(result.requestId),
      /timeout/,
    );
    assert.equal(
      (await refunds.executeProviderRefundAsAuthenticatedUser(result.requestId)).status,
      "needs_attention",
    );
    assert.equal(calls, 1, "unknown provider outcome must not cause another outbound refund");
    actor = "foreign-refund-actor";
    await assert.rejects(
      () => refunds.executeProviderRefundAsAuthenticatedUser(result.requestId),
      /not authorized/,
    );
    assert.equal(calls, 1);
  },
);

integration(
  "provider response cannot overwrite a refund webhook that completed first",
  async (query) => {
    const ids = await payment(query);
    await webhook(query, ids);
    const [{ result }] = await query(
      `select prepare_provider_refund_for_payment($1,$2,'regression') result`,
      [ids.payment, ids.user],
    );
    const refunds = loadTypeScript("src/lib/market/refunds.server.ts", {
      "@/lib/db": { getSql: async () => ({ query }) },
      "@/lib/market/adapters/registry": {
        getPaymentAdapter: async () => ({
          refundPayment: async () => {
            await webhook(
              query,
              ids,
              ids.event + "-refund-race",
              100,
              ids.reference,
              "refunded",
              "refund.processed",
            );
            return { status: "processing", providerRefundId: "synthetic-refund" };
          },
        }),
      },
      "@/lib/observability/logger.server": { recordMetric: async () => {} },
      "@/lib/auth/verify.server": { requireFreshSession: async () => ids.user },
      "@/lib/auth/authorization.server": {
        requireAdminForUserId: async () => {
          throw new Error("Not admin");
        },
      },
    });
    const outcome = await refunds.executeProviderRefundAsAuthenticatedUser(result.requestId);
    assert.equal(outcome.status, "processed");
    assert.equal(
      (
        await query(`select status from provider_refund_requests where id=$1`, [result.requestId])
      )[0].status,
      "processed",
    );
  },
);

integration(
  "refund preparation enforces customer ownership and preserves provider-confirmed failure retries",
  async (query, client) => {
    const ids = await payment(query);
    const other = await payment(query);
    await webhook(query, ids);
    await rejectsSql(
      client,
      () =>
        query(`select prepare_provider_refund_for_payment($1,$2,'foreign')`, [
          ids.payment,
          other.user,
        ]),
      /not owned/,
    );
    const [{ result }] = await query(
      `select prepare_provider_refund_for_payment($1,$2,'owned') result`,
      [ids.payment, ids.user],
    );
    await query(`update provider_refund_requests set status='failed' where id=$1`, [
      result.requestId,
    ]);
    const [{ result: retry }] = await query(
      `select prepare_provider_refund_for_payment($1,$2,'confirmed failure') result`,
      [ids.payment, ids.user],
    );
    assert.equal(retry.requestId, result.requestId);
    assert.equal(retry.status, "requested");
    assert.equal(retry.retry, true);
    assert.equal(
      (await query(`select id from provider_refund_requests where payment_id=$1`, [ids.payment]))
        .length,
      1,
    );
  },
);

integration(
  "actual order ownership and merchant membership reject foreign customer and merchant access",
  async (query) => {
    const ids = await payment(query);
    const other = await payment(query);
    const ownership = loadTypeScript("src/lib/market/ownership.server.ts", {
      "@/lib/db": { getSql: async () => ({ query }) },
    });
    assert.equal((await ownership.requireCustomerOrder(ids.order, ids.user)).id, ids.order);
    await assert.rejects(() => ownership.requireCustomerOrder(ids.order, other.user), /not found/);
    await assert.rejects(
      () => ownership.requireCustomerPayment(ids.payment, other.user),
      /not found/,
    );
    await assert.rejects(
      () => ownership.requireMerchantOrder(ids.order, other.merchant),
      /not found/,
    );
    const auth = loadTypeScript("src/lib/auth/authorization.server.ts", {
      "../db": { getSql: async () => ({ query }) },
      "./verify.server": {},
      "./server": { auth: {} },
      "@tanstack/react-start/server": { getRequest: () => null },
    });
    await query(`insert into merchant_accounts(merchant_id,user_id) values($1,$2)`, [
      ids.merchant,
      ids.user,
    ]);
    assert.equal(
      (await auth.requireMerchantAccessForUserId(ids.merchant, ids.user)).userId,
      ids.user,
    );
    await assert.rejects(
      () => auth.requireMerchantAccessForUserId(ids.merchant, other.user),
      /denied/,
    );
    await query(`update merchant_accounts set status='revoked' where merchant_id=$1`, [
      ids.merchant,
    ]);
    await assert.rejects(
      () => auth.requireMerchantAccessForUserId(ids.merchant, ids.user),
      /denied/,
    );
  },
);

test(
  "independent worker instances share PostgreSQL nonce replay protection",
  { skip: !enabled },
  async () => {
    const { signedWorkerRequest } = await import("./internal-worker-request.mjs");
    const request = signedWorkerRequest(
      "https://example.invalid/api/internal/brand-integration-worker",
      "synthetic-worker-secret",
    );
    const auth = () =>
      loadTypeScript("src/lib/security/internal-job-auth.server.ts", {
        "@/lib/db": {
          getSql: async () => ({ query: async (s, p) => (await pool.query(s, p)).rows }),
        },
      });
    try {
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          auth().authorizeInternalHmacRequest(request.clone(), "synthetic-worker-secret"),
        ),
      );
      assert.equal(results.filter(Boolean).length, 1);
      assert.equal(
        await auth().authorizeInternalHmacRequest(request.clone(), "synthetic-worker-secret"),
        false,
      );
    } finally {
      await pool.query(`delete from internal_job_nonces where nonce=$1`, [
        request.headers.get("x-elemarket-sync-nonce"),
      ]);
    }
  },
);

integration(
  "admin refund handler resolves real payment binding and enforces the admin session",
  async (query) => {
    const { serverFunctionStub } = await import("./helpers/load-typescript.mjs");
    const ids = await payment(query);
    const administrator = await payment(query);
    await webhook(query, ids);
    await query(`update "user" set role='admin',"twoFactorEnabled"=true where id=$1`, [
      administrator.user,
    ]);
    await query(`insert into session(id,token,"userId","expiresAt","createdAt","updatedAt") values($1,$1,$2,now()+interval '1 hour',now(),now())`, [administrator.payment,administrator.user]);
    await query(`insert into admin_session_assurance(session_id,user_id,method,verified_at) values($1,$2,'totp',now())`, [administrator.payment,administrator.user]);
    const assurance = loadTypeScript("src/lib/auth/authorization.server.ts", {
      "../db": { getSql: async () => ({ query }) },
      "./verify.server": {},
      "./server": {
        auth: {
          api: {
            getSession: async () => ({
              user: { id: administrator.user },
              session: { id: administrator.payment, createdAt: new Date(Date.now() + 1000) },
            }),
          },
        },
      },
      "@tanstack/react-start/server": { getRequest: () => new Request("https://example.invalid") },
    });
    let calls = 0;
    const refunds = loadTypeScript("src/lib/market/refunds.server.ts", {
      "@/lib/db": { getSql: async () => ({ query }) },
      "@/lib/market/adapters/registry": {
        getPaymentAdapter: async () => ({
          refundPayment: async () => {
            calls++;
            return { status: "processing", providerRefundId: "admin-regression" };
          },
        }),
      },
      "@/lib/observability/logger.server": { recordMetric: async () => {} },
      "@/lib/auth/verify.server": { requireFreshSession: async () => administrator.user },
      "@/lib/auth/authorization.server": assurance,
    });
    const permissions = loadTypeScript("src/lib/admin/permissions.server.ts", {
      "@/lib/auth/authorization.server": assurance,
      "@/lib/auth/verify.server": { requireFreshSession: async () => administrator.user },
    });
    const admin = loadTypeScript("src/routes/admin/dashboard.functions.ts", {
      "@/lib/admin/permissions.server": permissions,
      "@tanstack/react-start": { createServerFn: serverFunctionStub },
      "@/lib/db": { getSql: async () => ({ query }) },
      "@/lib/auth/middleware": {
        authMiddleware: {},
        getAuthenticatedUserId: (context) => context.userId,
      },
      "@/lib/auth/authorization.server": assurance,
      "@/lib/auth/verify.server": { requireFreshSession: async () => administrator.user },
      "@/lib/security/rate-limit.server": { enforceRateLimit: async () => {} },
      "@/lib/market/refunds.server": refunds,
    });
    await assert.rejects(
      () =>
        admin.requestAdminProviderRefund({
          data: { orderId: ids.order },
          context: { userId: ids.user },
        }),
      /Forbidden/,
    );
    assert.equal(calls, 0);
    const result = await admin.requestAdminProviderRefund({
      data: { orderId: ids.order },
      context: { userId: administrator.user },
    });
    assert.equal(result.status, "processing");
    assert.equal(calls, 1);
  },
);

test(
  "concurrent refund invocations dispatch exactly one provider operation",
  { skip: !enabled },
  async () => {
    const query = async (s, p) => (await pool.query(s, p)).rows;
    const ids = await payment(query);
    await webhook(query, ids);
    const [{ result }] = await query(
      `select prepare_provider_refund_for_payment($1,$2,'concurrent regression') result`,
      [ids.payment, ids.user],
    );
    let calls = 0;
    const refunds = () =>
      loadTypeScript("src/lib/market/refunds.server.ts", {
        "@/lib/db": { getSql: async () => ({ query }) },
        "@/lib/market/adapters/registry": {
          getPaymentAdapter: async () => ({
            refundPayment: async () => {
              calls++;
              return { status: "processing", providerRefundId: "concurrent-refund" };
            },
          }),
        },
        "@/lib/observability/logger.server": { recordMetric: async () => {} },
        "@/lib/auth/verify.server": { requireFreshSession: async () => ids.user },
        "@/lib/auth/authorization.server": {
          requireAdminForUserId: async () => {
            throw new Error("Not admin");
          },
        },
      });
    const outcomes = await Promise.all(
      Array.from({ length: 8 }, () =>
        refunds().executeProviderRefundAsAuthenticatedUser(result.requestId),
      ),
    );
    assert.equal(calls, 1);
    assert.ok(outcomes.every((outcome) => outcome.status === "processing"));
    assert.equal(
      (
        await query(`select status from provider_refund_requests where id=$1`, [result.requestId])
      )[0].status,
      "processing",
    );
  },
);

integration(
  "expired rate-limit buckets reset atomically instead of causing a duplicate-key outage",
  async (query) => {
    const prefix = randomUUID();
    const [{ key }] = await query(
      `select $1||n as key from generate_series(1,200) n where mod(hashtextextended($1||n,1),100)<>0 limit 1`,
      [prefix],
    );
    await query(
      `insert into api_rate_limit_buckets(bucket_key,window_start,request_count,expires_at) values($1,now()-interval '2 minutes',3,now()-interval '1 minute')`,
      [key],
    );
    const attempts = [];
    for (let i = 0; i < 4; i++)
      attempts.push(
        (await query(`select consume_api_rate_limit($1,60,3) result`, [key]))[0].result,
      );
    assert.deepEqual(
      attempts.map((result) => result.allowed),
      [true, true, true, false],
    );
    assert.deepEqual(
      attempts.map((result) => result.remaining),
      [2, 1, 0, 0],
    );
  },
);

test(
  "concurrent requests at rate-limit rollover preserve the exact allowed count",
  { skip: !enabled },
  async () => {
    const key = "rollover-" + randomUUID();
    await pool.query(
      `insert into api_rate_limit_buckets(bucket_key,window_start,request_count,expires_at) values($1,now()-interval '2 minutes',3,now()-interval '1 minute')`,
      [key],
    );
    try {
      const outcomes = await Promise.all(
        Array.from(
          { length: 12 },
          async () =>
            (await pool.query(`select consume_api_rate_limit($1,60,3) result`, [key])).rows[0]
              .result,
        ),
      );
      assert.equal(outcomes.filter((outcome) => outcome.allowed).length, 3);
      assert.equal(
        (
          await pool.query(`select request_count from api_rate_limit_buckets where bucket_key=$1`, [
            key,
          ])
        ).rows[0].request_count,
        3,
      );
    } finally {
      await pool.query(`delete from api_rate_limit_buckets where bucket_key=$1`, [key]);
    }
  },
);
