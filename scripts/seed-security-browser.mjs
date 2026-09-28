import assert from "node:assert/strict";
import { Pool } from "pg";
import { hashPassword } from "better-auth/crypto";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createPaymentFixture } from "./helpers/payment-fixture.mjs";
assert.equal(
  process.env.ELEMARKET_ALLOW_SYNTHETIC_SEED,
  "1",
  "Explicit synthetic seed opt-in required",
);
assert.ok(
  !["production", "staging"].includes(process.env.ELEMARKET_ENV),
  "Never seed shared environments",
);
const databaseUrl = new URL(process.env.ELEMARKET_INTEGRATION_DATABASE_URL);
assert.ok(
  ["localhost", "127.0.0.1"].includes(databaseUrl.hostname),
  "Only disposable loopback databases are supported",
);
assert.ok(process.env.ELEMARKET_BROWSER_FIXTURE, "Private fixture output path required");
const pool = new Pool({ connectionString: databaseUrl.href });
const client = await pool.connect();
const query = async (s, p) => (await client.query(s, p)).rows;
try {
  await client.query("BEGIN");
  const owner = await createPaymentFixture(query),
    foreign = await createPaymentFixture(query),
    paid = await createPaymentFixture(query, { ownerId: owner.user });
  const password = randomBytes(24).toString("base64url");
  await query(
    'insert into account(id,"accountId","providerId","userId",password,"updatedAt") values($1,$1,\'credential\',$1,$2,now())',
    [owner.user, await hashPassword(password)],
  );
  // Give this owner's second order an actual completed synthetic payment through the normal state machine.
  await query("select create_payment_attempt($1,$2,100,'GHS','{}'::jsonb)", [
    paid.payment,
    paid.provider,
  ]);
  await query("update payment_attempts set provider_reference=$1 where payment_id=$2", [
    "qa-" + paid.payment,
    paid.payment,
  ]);
  await query("select apply_payment_webhook($1,$2,'charge.success',$3,'completed',100,'GHS',$4)", [
    paid.provider,
    paid.event,
    "qa-" + paid.payment,
    "a".repeat(64),
  ]);
  writeFileSync(
    process.env.ELEMARKET_BROWSER_FIXTURE,
    JSON.stringify({
      email: owner.user + "@integration.test",
      password,
      orderId: owner.order,
      foreignOrderId: foreign.order,
      paidOrderId: paid.order,
    }),
    { mode: 0o600 },
  );
  await client.query("COMMIT");
  console.log("Synthetic browser fixtures created; credentials saved privately.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
