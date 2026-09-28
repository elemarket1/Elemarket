import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const governance = read("migrations/0040_core_governance.sql");

test("core governance: audit evidence is append-only and retained outside operational purge", () => {
  assert.match(governance, /create table if not exists audit_events/i);
  assert.match(governance, /reject_audit_mutation/);
  assert.match(governance, /audit_events_no_update/);
  assert.match(governance, /audit_events_no_delete/);
  assert.match(governance, /audit\/financial evidence|financial\/security evidence|financial, security evidence/i);
});

test("core governance: merchant verification is provider-neutral", () => {
  assert.match(governance, /merchant_verification_checks/);
  assert.match(governance, /check_type.*email.*phone.*identity.*business.*document.*payout/s);
  assert.match(governance, /provider_key/);
  assert.match(governance, /provider_reference/);
});

test("core governance: merchant approval is gated by email + phone verification and audited", () => {
  assert.match(governance, /review_merchant_application/);
  assert.match(governance, /email.*verified/s);
  assert.match(governance, /phone.*verified/s);
  const ownership = read("migrations/0007_security_financing_integrity.sql");
  assert.match(ownership, /create table if not exists merchant_accounts/);
  assert.match(governance, /merchant_verification_checks/);
  assert.match(governance, /perform record_audit_event/);
});

test("core governance: operational retention is explicit and excludes audit evidence", () => {
  assert.match(governance, /data_retention_policies/);
  assert.match(governance, /purge_operational_retention_data/);
  assert.doesNotMatch(governance.slice(governance.indexOf("purge_operational_retention_data")), /delete from audit_events/i);
});

test("core governance: admin review is server-only and requires a fresh authenticated session", () => {
  const src = read("src/routes/admin/merchant-review.functions.ts");
  assert.match(src, /authMiddleware/);
  assert.match(src, /requireAdminForUserId/);
  assert.match(src, /requireFreshSession/);
  assert.match(src, /review_merchant_application/);
});

test("core governance: backup and DR are documented as infrastructure controls", () => {
  const doc = read("docs/CORE_GOVERNANCE_AND_DR.md");
  assert.match(doc, /automated backups\/PITR/i);
  assert.match(doc, /restore drill/i);
  assert.match(doc, /financial.*(payment|provider).*settlement.*audit/i);
});
