import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const migration = fs.readFileSync("migrations/0121_provider_refund_retry_authorization.sql", "utf8");
const refunds = fs.readFileSync("src/lib/market/refunds.server.ts", "utf8");

test("failed provider refunds are retryable without creating a second request", () => {
  assert.match(migration, /status in \('requested','processing','needs_attention','failed','processed'\)/);
  assert.match(migration, /v_existing\.status = 'failed'/);
  assert.match(migration, /set status='requested'/);
});

test("provider refund execution is actor-bound", () => {
  assert.match(refunds, /requested_by/);
  assert.match(refunds, /actor\[0\]\.role !== "admin"/);
  assert.match(refunds, /actor\[0\]\.requested_by !== input\.actorId/);
});
