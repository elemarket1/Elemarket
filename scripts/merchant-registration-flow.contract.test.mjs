import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const register = fs.readFileSync(new URL("../src/routes/merchant/register.tsx", import.meta.url), "utf8");
const account = fs.readFileSync(new URL("../src/lib/auth/account.functions.ts", import.meta.url), "utf8");

test("merchant registration reuses an existing signed-in account", () => {
  assert.match(register, /getMerchantRegistrationContext/);
  assert.match(register, /if \(signedIn\)/);
  assert.match(register, /submit merchant application/i);
  assert.ok(register.indexOf("if (signedIn) {") < register.indexOf("if (!password"));
  assert.ok(register.indexOf("authClient.signUp.email") > register.indexOf("if (!password"));
});

test("new-account merchant registration still verifies email before application submission", () => {
  assert.match(register, /authClient\.signUp\.email/);
  assert.match(register, /purpose: "signup"/);
  assert.match(register, /verifyEmailOtpCode/);
  assert.match(register, /createMerchantApplication/);
});

test("merchant application carries existing email verification into the verification checks", () => {
  assert.match(account, /check_type='email'/);
  assert.match(account, /status='verified'/);
  assert.match(account, /merchant_verification_checks/);
});

test("changing a customer's phone clears the previous phone verification", () => {
  assert.match(account, /phone_verified_at=case when profiles\.phone is distinct from excluded\.phone then null/);
});

test("phone verification is still bound to the merchant application", () => {
  assert.match(account, /expectedPurpose: "phone_verification"/);
  assert.match(account, /check_type='phone'/);
});
