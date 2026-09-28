import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import crypto from "node:crypto";

test("all Vercel cron paths have corresponding route files", () => {
  const vercel = JSON.parse(fs.readFileSync("vercel.json", "utf8"));
  for (const cron of vercel.crons ?? []) {
    const route = cron.path.replace(/^\//, "").replace(/\//g, ".") + ".ts";
    const candidates = [
      `src/routes/${route}`,
      `src/routes/${cron.path.replace(/^\//, "")}.ts`,
    ];
    assert.ok(candidates.some((p) => fs.existsSync(p)), `missing cron route: ${cron.path}`);
  }
});

test("financial refund boundary resolves actor internally", () => {
  const source = fs.readFileSync("src/lib/market/refunds.server.ts", "utf8");
  assert.match(source, /executeProviderRefundAsAuthenticatedUser/);
  assert.match(source, /requireFreshSession/);
  assert.doesNotMatch(source, /export async function executeProviderRefund\(/);
  assert.match(fs.readFileSync("src/lib/market/orders.ts", "utf8"), /executeProviderRefundAsAuthenticatedUser/);
  assert.match(fs.readFileSync("src/routes/admin/dashboard.functions.ts", "utf8"), /executeProviderRefundAsAdmin/);
});

test("internal worker authentication has replay-resistant nonce and body binding", () => {
  const source = fs.readFileSync("src/lib/security/internal-job-auth.server.ts", "utf8");
  assert.match(source, /x-elemarket-sync-nonce/);
  assert.match(source, /x-elemarket-body-sha256/);
  assert.match(source, /internal_job_nonces/);
  assert.match(fs.readFileSync("migrations/0128_internal_job_nonce_replay_protection.sql", "utf8"), /primary key/);
});

test("migration manifest covers every SQL migration", () => {
  const manifest = JSON.parse(fs.readFileSync("migrations.sha256.json", "utf8"));
  for (const name of fs.readdirSync("migrations").filter((n) => n.endsWith(".sql"))) {
    const hash = crypto.createHash("sha256").update(fs.readFileSync(`migrations/${name}`)).digest("hex");
    assert.equal(manifest[name], hash, `migration checksum mismatch: ${name}`);
  }
});

test("money parser rejects silent fractional truncation", () => {
  const source = fs.readFileSync("src/lib/market/money.ts", "utf8");
  assert.match(source, /at most two decimal places/);
});

test("shared environments require explicit enterprise sync secret", () => {
  const source = fs.readFileSync("scripts/validate-startup-env.mjs", "utf8");
  assert.match(source, /ELEMARKET_ENTERPRISE_SYNC_SECRET/);
});

test("migration 0106 avoids invalid aggregate selection across pre-aggregated CTEs", () => {
  const source = fs.readFileSync("migrations/0106_marketplace_post_purchase_hardening.sql", "utf8");
  assert.match(source, /'avgRating',\(select avg_rating from reviews_agg\)/);
  assert.match(source, /'reviewCount',\(select review_count from reviews_agg\)/);
  assert.match(source, /'returnCount',\(select return_count from returns_agg\)/);
  assert.match(source, /'disputeCount',\(select dispute_count from disputes_agg\)/);
  assert.match(source, /\) from scope;/);
  assert.doesNotMatch(source, /from scope, reviews_agg, returns_agg, disputes_agg;/);
});
