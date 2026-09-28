import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

const readBody = loadTypeScript("src/lib/security/body.server.ts");
const noLimit = { enforceRateLimit: async () => {} };
const authModule = (role, enabled, createdAt = new Date(), enabledAt = new Date(0)) =>
  loadTypeScript("src/lib/auth/authorization.server.ts", {
    "./verify.server": { requireUserId: async () => "actor" },
    "@tanstack/react-start/server": { getRequest: () => new Request("https://example.test") },
    "./server": {
      auth: {
        api: { getSession: async () => ({ user: { id: "actor" }, session: { createdAt } }) },
      },
    },
    "../db": {
      getSql: async () => ({
        query: async (sql) =>
          sql.includes("coalesce") ? [{ enabled, enabled_at: enabledAt }] : [{ role }],
      }),
    },
  });

test("all role-based admin shortcuts require MFA and post-enrollment sessions", async () => {
  for (const [enabled, createdAt, enabledAt] of [
    [false, new Date(), new Date(0)],
    [true, new Date(0), new Date()],
  ]) {
    const auth = authModule("admin", enabled, createdAt, enabledAt);
    for (const check of [
      () => auth.requireAdminForUserId("actor"),
      () => auth.requireMerchantAccessForUserId("other-merchant", "actor"),
      () => auth.requireMerchantOrAdminForUserId("actor"),
      () => auth.requireCustomerOrAdminForUserId("actor"),
    ])
      await assert.rejects(check, /two-factor/);
  }
  assert.equal(
    (await authModule("admin", true).requireMerchantAccessForUserId("other", "actor")).role,
    "admin",
  );
  await assert.rejects(
    () => authModule("customer", false).requireAdminForUserId("actor"),
    /Forbidden/,
  );
});

test("one Ghana normalizer accepts each required spelling and rejects invalid contacts", () => {
  const { normalizeGhanaPhone, ghanaPhoneSchema } = loadTypeScript("src/lib/auth/phone.ts");
  for (const value of ["0201111111", "233201111111", "+233201111111"]) {
    assert.equal(normalizeGhanaPhone(value), "+233201111111");
    assert.equal(ghanaPhoneSchema.parse(value), "+233201111111");
  }
  for (const value of ["", "+1201111111", "23320111111", "233201111111<script>"])
    assert.throws(() => normalizeGhanaPhone(value));
});

test("non-Vercel proxy ignores spoofed platform header while genuine Vercel header remains supported", async () => {
  const before = { ...process.env };
  const keys = [];
  let request;
  try {
    process.env.ELEMARKET_TRUST_PROXY = "1";
    delete process.env.VERCEL;
    delete process.env.REDIS_URL;
    const limiter = loadTypeScript("src/lib/security/rate-limit.server.ts", {
      "@tanstack/react-start/server": { getRequest: () => request },
      "@/lib/db": {
        getSql: async () => ({
          query: async (_sql, p) => {
            keys.push(p[0]);
            return [{ result: { allowed: true, remaining: 1, resetAt: 0 } }];
          },
        }),
      },
      "@/lib/observability/security-alert.server": { emitSecurityAlert: async () => {} },
      "@/lib/security/native-redis-rate-limit.server": {
        nativeRedisRateLimit: async () => ({ count: 0, ttl: 60 }),
        supportsNativeRedisUrl: () => false,
      },
    });
    for (const forged of ["203.0.113.1", "203.0.113.2"]) {
      request = new Request("https://example.test", {
        headers: { "x-forwarded-for": "198.51.100.1", "x-vercel-forwarded-for": forged },
      });
      await limiter.enforceRateLimit("otp", { windowSeconds: 60, maxRequests: 1 });
    }
    assert.equal(keys[0], keys[1]);
    process.env.VERCEL = "1";
    await limiter.enforceRateLimit("otp", { windowSeconds: 60, maxRequests: 1 });
    assert.notEqual(keys[1], keys[2]);
    delete process.env.VERCEL;
    for (const ip of ["198.51.100.2", "198.51.100.3"]) {
      request = new Request("https://example.test", { headers: { "x-forwarded-for": ip } });
      await limiter.enforceRateLimit("otp-destination", {
        windowSeconds: 60,
        maxRequests: 1,
        subject: "same-phone",
        identity: "subject",
      });
    }
    assert.equal(keys[3], keys[4], "destination cap must survive IP rotation");
  } finally {
    process.env = before;
  }
});

function workerAuth() {
  const used = new Set();
  return loadTypeScript("src/lib/security/internal-job-auth.server.ts", {
    "@/lib/db": {
      getSql: async () => ({
        query: async (sql, p) => {
          if (!sql.startsWith("insert")) return [];
          if (used.has(p[0])) return [];
          used.add(p[0]);
          return [{ nonce: p[0] }];
        },
      }),
    },
  });
}
function signedRequest(body = "", path = "/api/internal/enterprise-order-outbox") {
  const timestamp = String(Date.now()),
    nonce = "unique-audit-nonce",
    secret = "synthetic-hmac-secret";
  const hash = createHash("sha256").update(body).digest("hex");
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${nonce}.POST.${path}.${hash}`)
    .digest("hex");
  return new Request(`https://example.test${path}`, {
    method: "POST",
    body,
    headers: {
      "x-elemarket-sync-timestamp": timestamp,
      "x-elemarket-sync-nonce": nonce,
      "x-elemarket-sync-signature": signature,
    },
  });
}

test("worker HMAC binds body/path and consumes nonce exactly once", async () => {
  const { authorizeInternalHmacRequest: auth } = workerAuth();
  const request = signedRequest("{}");
  assert.equal(await auth(request.clone(), "synthetic-hmac-secret"), true);
  assert.equal(await auth(request.clone(), "synthetic-hmac-secret"), false);
  const wrong = new Request("https://example.test/other", {
    method: "POST",
    body: "{}",
    headers: request.headers,
  });
  assert.equal(
    await workerAuth().authorizeInternalHmacRequest(wrong, "synthetic-hmac-secret"),
    false,
  );
});

test("worker rejects oversized chunked body before draining stream or touching DB", async () => {
  let cancelled = false,
    pulled = 0;
  const body = new ReadableStream({
    pull(controller) {
      pulled++;
      controller.enqueue(new Uint8Array(2048));
    },
    cancel() {
      cancelled = true;
    },
  });
  const headers = signedRequest().headers;
  const request = new Request("https://example.test/api/internal/enterprise-order-outbox", {
    method: "POST",
    body,
    duplex: "half",
    headers,
  });
  assert.equal(
    await workerAuth().authorizeInternalHmacRequest(request, "synthetic-hmac-secret"),
    false,
  );
  assert.equal(cancelled, true);
  assert.ok(pulled <= 2);
});

test("cron and HMAC secrets are independent and neither grants the other transport", async () => {
  const auth = workerAuth().authorizeInternalHmacRequest;
  const cron = new Request("https://example.test/api/internal/enterprise-order-outbox", {
    headers: { authorization: "Bearer cron-only", "user-agent": "vercel-cron/1.0" },
  });
  assert.equal(await auth(cron, "hmac-only", "cron-only"), true);
  assert.equal(await auth(cron, "cron-only", "different-cron"), false);
  assert.equal(await auth(cron, "cron-only"), false);
});

test("enterprise webhook acknowledges only durable success and responds retryably on storage failure", async () => {
  for (const fail of [false, true]) {
    const route = loadTypeScript("src/routes/api.enterprise.catalog.webhook.ts", {
      "@tanstack/react-router": { createFileRoute: () => (x) => x },
      "@/lib/market/enterprise-integration.server": {
        enqueueEnterpriseWebhookEvent: async () => {
          if (fail) throw new Error("storage unavailable");
          return { duplicate: false };
        },
      },
      "@/lib/market/enterprise-catalog.server": { verifyEnterpriseWebhook: async () => true },
      "@/lib/security/rate-limit.server": noLimit,
      "@/lib/security/body.server": readBody,
    }).Route;
    const response = await route.server.handlers.POST({
      request: new Request("https://example.test/api/enterprise/catalog/webhook?merchantId=m", {
        method: "POST",
        body: "{}",
      }),
    });
    assert.equal(response.status, fail ? 503 : 202);
  }
});

test("actual production startup rejects missing configuration before starting an application", () => {
  const child = spawnSync(process.execPath, ["scripts/start.mjs"], {
    env: { PATH: process.env.PATH, NODE_ENV: "production", ELEMARKET_ENV: "production" },
    encoding: "utf8",
  });
  assert.equal(child.status, 1);
  assert.match(child.stderr, /missing required production environment variables|PG_SSL_MODE=verify-full|Trusted client-IP configuration/);
  assert.doesNotMatch(child.stdout, /starting Nitro server/);
});

test("slow body is cancelled when its deadline expires", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request("https://example.test", {
    method: "POST",
    body: stream,
    duplex: "half",
  });
  await assert.rejects(() => readBody.readBodyWithLimit(request, 1024, 10), /timed out/);
  assert.equal(cancelled, true);
});

test("provider timeout, bad signature, and transaction mismatches cannot apply a payment webhook", async () => {
  for (const scenario of [
    "timeout",
    "invalid-signature",
    "wrong-reference",
    "wrong-amount",
    "success",
    "persisted-rejection",
  ]) {
    let applied = 0;
    const errorTypes = loadTypeScript("src/lib/market/payment-errors.ts");
    const module = loadTypeScript("src/lib/market/payment.server.ts", {
      "@/lib/db": {
        getSql: async () => ({
          query: async (sql) => {
            if (sql.includes("from payment_providers"))
              return [{ provider_key: "audit", driver_key: "audit" }];
            if (sql.includes("from payment_attempts")) return [{ id: "attempt" }];
            if (sql.includes("apply_payment_webhook")) {
              applied++;
              return [
                {
                  result:
                    scenario === "persisted-rejection"
                      ? { rejected: true }
                      : { reconciliationRequired: true },
                },
              ];
            }
            throw new Error("Unexpected SQL");
          },
        }),
      },
      "@/lib/market/ownership.server": {},
      "@/lib/market/refunds.server": { executeLatePaymentRefund: async () => {} },
      "@/lib/market/adapters/registry": {
        getPaymentAdapter: async () => ({
          verifyWebhook: async () => scenario !== "invalid-signature",
          parseWebhook: async () => ({
            providerReference: "reference",
            status: "completed",
            currency: "GHS",
            amount: 100,
            eventId: "event",
            eventType: "charge.success",
          }),
          verifyTransaction: async () => {
            if (scenario === "timeout") throw new errorTypes.PaymentProviderError("timeout", 503);
            return {
              reference: scenario === "wrong-reference" ? "other" : "reference",
              status: "success",
              amount: scenario === "wrong-amount" ? 99 : 100,
              currency: "GHS",
            };
          },
        }),
      },
      "@/lib/observability/logger.server": { recordMetric: async () => {} },
      "@/lib/observability/security-alert.server": { emitSecurityAlert: async () => {} },
      "@/lib/security/rate-limit.server": noLimit,
      "@/lib/market/provider-policy.server": { normalizeProviderKey: (x) => x },
      "@/lib/env.server": {},
      "@/lib/market/payment-errors": errorTypes,
    });
    const call = () => module.handlePaymentWebhook({ rawBody: "{}", signature: "synthetic" });
    if (scenario === "success") assert.equal((await call()).reconciliationRequired, true);
    else
      await assert.rejects(
        call,
        (error) =>
          error instanceof errorTypes.PaymentWebhookError &&
          error.status ===
            (scenario === "timeout" ? 503 : scenario === "invalid-signature" ? 401 : 400),
      );
    assert.equal(applied, ["success", "persisted-rejection"].includes(scenario) ? 1 : 0);
  }
});

test("refund provider failure or timeout is recorded as needs_attention, never as processed", async () => {
  for (const message of ["provider rejected", "provider timeout"]) {
    let status = "requested",
      calls = 0;
    const module = loadTypeScript("src/lib/market/refunds.server.ts", {
      "@/lib/db": {
        getSql: async () => ({
          query: async (sql) => {
            if (sql === 'select role from "user" where id=$1 limit 1')
              return [{ role: "customer" }];
            if (sql.includes("select u.role"))
              return [{ role: "customer", requested_by: "customer" }];
            if (sql.includes("select p.driver_key")) return [{ driver_key: "audit" }];
            if (sql.includes("set status='processing'")) {
              status = "processing";
              return [
                {
                  id: "refund",
                  provider_key: "audit",
                  provider_reference: "reference",
                  amount: "100",
                  currency: "GHS",
                },
              ];
            }
            if (sql.includes("set status='needs_attention'")) {
              status = "needs_attention";
              return [];
            }
            throw new Error("Unexpected SQL");
          },
        }),
      },
      "@/lib/market/adapters/registry": {
        getPaymentAdapter: async () => ({
          capabilities: { refund: true },
          refundPayment: async () => {
            calls++;
            throw new Error(message);
          },
        }),
      },
      "@/lib/observability/logger.server": { recordMetric: async () => {} },
      "@/lib/auth/verify.server": { requireFreshSession: async () => "customer" },
      "@/lib/auth/authorization.server": {
        requireAdminForUserId: async () => {
          throw new Error("unexpected admin");
        },
      },
    });
    await assert.rejects(
      () => module.executeProviderRefundAsAuthenticatedUser("refund"),
      new RegExp(message),
    );
    assert.equal(calls, 1);
    assert.equal(status, "needs_attention");
  }
});

test("shared release gate cannot silently skip when deployment markers are missing", () => {
  const child = spawnSync(
    process.execPath,
    ["scripts/validate-startup-env.mjs", "--require-shared"],
    { env: { PATH: process.env.PATH }, encoding: "utf8" },
  );
  assert.equal(child.status, 1);
  assert.match(child.stderr, /explicitly set to production or staging/);
});
