import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { loadTypeScript } from "./helpers/load-typescript.mjs";
import { signedWorkerRequest } from "./internal-worker-request.mjs";

const url = "https://example.invalid/api/internal/brand-integration-worker";
const secret = "synthetic-worker-regression-secret";

function worker() {
  const used = new Set();
  let runs = 0;
  const auth = loadTypeScript("src/lib/security/internal-job-auth.server.ts", {
    "@/lib/db": {
      getSql: async () => ({
        query: async (sql, params) => {
          if (!sql.startsWith("insert")) return [];
          if (used.has(params[0])) return [];
          used.add(params[0]);
          return [{ nonce: params[0] }];
        },
      }),
    },
  });
  const { Route } = loadTypeScript("src/routes/api.internal.brand-integration-worker.ts", {
    "@tanstack/react-router": { createFileRoute: () => (route) => route },
    "@/lib/security/internal-job-auth.server": auth,
    "@/lib/security/rate-limit.server": { enforceRateLimit: async () => {} },
    "@/lib/market/brand-integration.server": {
      processBrandIntegrationWebhooks: async () => {
        runs++;
        return {};
      },
      processBrandIntegrationOrderOutbox: async () => ({}),
    },
  });
  return { run: (request) => Route.server.handlers.POST({ request }), count: () => runs };
}

function withSecret(fn) {
  return async () => {
    const previous = process.env.ELEMARKET_ENTERPRISE_SYNC_SECRET;
    process.env.ELEMARKET_ENTERPRISE_SYNC_SECRET = secret;
    try {
      await fn();
    } finally {
      if (previous === undefined) delete process.env.ELEMARKET_ENTERPRISE_SYNC_SECRET;
      else process.env.ELEMARKET_ENTERPRISE_SYNC_SECRET = previous;
    }
  };
}

test(
  "brand worker executes once and denies concurrent signed-request replay",
  withSecret(async () => {
    const handler = worker();
    const request = signedWorkerRequest(url, secret);
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => handler.run(request.clone())),
    );
    assert.deepEqual(
      responses.map((response) => response.status).sort(),
      [200, 401, 401, 401, 401, 401, 401, 401],
    );
    assert.equal(handler.count(), 1);
    assert.equal((await handler.run(request.clone())).status, 401);
    assert.equal((await handler.run(signedWorkerRequest(url, secret))).status, 200);
  }),
);

test(
  "brand worker rejects missing, legacy, wrong-secret, expired and altered proofs without executing work",
  withSecret(async () => {
    const timestamp = String(Date.now());
    const legacy = createHmac("sha256", secret)
      .update(`${timestamp}.POST.${new URL(url).pathname}`)
      .digest("hex");
    const valid = signedWorkerRequest(url, secret, "{}");
    const expiredHeaders = new Headers(valid.headers);
    expiredHeaders.set("x-elemarket-sync-timestamp", String(Date.now() - 600_000));
    const requests = [
      new Request(url, { method: "POST" }),
      new Request(url, { method: "POST", headers: { "x-elemarket-sync-secret": secret } }),
      new Request(url, {
        method: "POST",
        headers: { "x-elemarket-sync-timestamp": timestamp, "x-elemarket-sync-signature": legacy },
      }),
      signedWorkerRequest(url, "wrong-secret"),
      new Request(url, { method: "POST", headers: expiredHeaders, body: "{}" }),
      new Request(url, { method: "POST", headers: valid.headers, body: "altered" }),
      new Request(url + "/other", { method: "POST", headers: valid.headers, body: "{}" }),
    ];
    const handler = worker();
    for (const request of requests) assert.equal((await handler.run(request)).status, 401);
    assert.equal(handler.count(), 0);
  }),
);

test("worker caller uses unique nonces, refuses unsafe transport and never follows redirects", () => {
  const first = signedWorkerRequest(url, secret);
  const second = signedWorkerRequest(url, secret);
  assert.notEqual(
    first.headers.get("x-elemarket-sync-nonce"),
    second.headers.get("x-elemarket-sync-nonce"),
  );
  assert.equal(first.redirect, "error");
  assert.throws(() => signedWorkerRequest("http://example.invalid/worker", secret), /HTTPS/);
  assert.throws(() => signedWorkerRequest(url + "?secret=bad", secret), /query/);
  assert.throws(() => signedWorkerRequest(url, secret, "x".repeat(1025)), /1024/);
});
