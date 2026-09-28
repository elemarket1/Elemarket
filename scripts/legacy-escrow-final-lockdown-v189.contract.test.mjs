import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const sql = fs.readFileSync("migrations/0120_legacy_escrow_execution_lockdown.sql", "utf8");

test("all historical escrow mutation functions are disabled", () => {
  for (const name of ["mark_escrow_release_pending", "open_escrow_dispute", "resolve_escrow_dispute"]) {
    assert.match(sql, new RegExp(`create or replace function\\s+${name}`));
    assert.match(sql, new RegExp(`legacy escrow .*disabled`, "i"));
  }
  assert.match(sql, /revoke all on function prepare_provider_refund_for_payment\(text,text,text\) from public/i);
});
