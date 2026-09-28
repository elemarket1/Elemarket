import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const account = await readFile(new URL("../src/lib/auth/account.functions.ts", import.meta.url), "utf8");
const register = await readFile(new URL("../src/routes/merchant/register.tsx", import.meta.url), "utf8");
const migration = await readFile(new URL("../migrations/0053_merchant_onboarding_compliance.sql", import.meta.url), "utf8");
const boundaryMigration = await readFile(new URL("../migrations/0058_marketplace_provider_settlement_boundary.sql", import.meta.url), "utf8");
const crypto = await readFile(new URL("../src/lib/security/merchant-sensitive.server.ts", import.meta.url), "utf8");
const admin = await readFile(new URL("../src/routes/admin/dashboard.functions.ts", import.meta.url), "utf8");

const requiredFields = [
  "registrationNumber",
  "taxpayerIdType",
  "taxpayerId",
  "businessType",
  "taxRegistrationStatus",
];

test("merchant onboarding requires core business and tax information", () => {
  for (const field of requiredFields) assert.match(account, new RegExp(`${field}:`));
  assert.match(account, /registrationNumber: z\.string\(\)\.trim\(\)\.min\(2\)/);
});

test("VAT status is optional at onboarding", () => {
  assert.match(account, /vatRegistrationStatus:.*\.nullable\(\)\.optional\(\)/);
  assert.match(register, /VAT registration status/);
  assert.match(migration, /vat_registration_status text/);
});

test("business number is enforced at the database boundary for new applications", () => {
  assert.match(migration, /if new\.registration_number is null or length\(trim\(new\.registration_number\)\) < 2/);
  assert.match(migration, /create trigger merchant_application_profile_validate/);
});

test("sensitive taxpayer data stays encrypted and admin-restricted", () => {
  assert.match(account, /encryptMerchantSensitiveData\(\{ taxpayerId:/);
  assert.match(crypto, /aes-256-gcm/);
  assert.match(admin, /viewMerchantSensitiveData|decryptMerchantSensitiveData/);
});



test("admin review data includes business and tax information without raw taxpayer IDs", () => {
  assert.match(admin, /businessNumber: string/);
  assert.match(admin, /taxpayerIdMasked: string \| null/);
  assert.match(admin, /taxRegistrationStatus: string \| null/);
  assert.match(admin, /vatRegistrationStatus: string \| null/);
});


test("merchant onboarding does not collect local settlement credentials", () => {
  assert.doesNotMatch(register, /Settlement details|bankAccountNumber|momoPhone|settlementMethod/);
  assert.doesNotMatch(account, /settlement_details_encrypted/);
  assert.match(boundaryMigration, /settlement is handled by the external payment provider/i);
});
