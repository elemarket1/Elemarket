import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
const root = process.cwd();
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

test("signup UI requires phone and persists it server-side", () => {
  const ui = read("src/routes/login.tsx");
  assert.match(ui, /Phone number/);
  assert.match(ui, /type="tel" required/);
  assert.match(ui, /saveSignupProfile/);
  const fn = read("src/lib/auth/account.functions.ts");
  assert.match(fn, /createServerFn/);
  assert.match(fn, /profiles/);
  assert.match(fn, /already registered/);
});

test("login exposes password reset and reset route uses Better Auth", () => {
  const ui = read("src/routes/login.tsx");
  assert.match(ui, /Forgot password\?/);
  const reset = read("src/routes/reset-password.tsx");
  assert.match(reset, /requestPasswordReset/);
  assert.match(reset, /resetPassword/);
});

test("password reset revokes other sessions and email sender is server-only", () => {
  const server = read("src/lib/auth/server.ts");
  assert.match(server, /sendResetPassword/);
  assert.match(server, /revokeSessionsOnPasswordReset:\s*true/);
  const email = read("src/lib/auth/email.server.ts");
  assert.match(email, /getEmailAdapter/);
  assert.match(email, /idempotencyKey/);
  assert.doesNotMatch(email, /ELEMARKET_EMAIL_ENDPOINT|ELEMARKET_EMAIL_SECRET/);
});

test("phone verification is bound to the authenticated user", () => {
  const otp = read("src/lib/auth/otp/otp.server.ts");
  assert.match(otp, /user_id/);
  assert.match(otp, /input.userId/);
  const fn = read("src/lib/auth/account.functions.ts");
  assert.match(fn, /expectedPurpose: "phone_verification"/);
  assert.match(fn, /phone_verified_at/);
});

test("migration adds phone verification state without replacing existing schema", () => {
  const migration = read("migrations/0042_auth_signup_phone_recovery.sql");
  assert.match(migration, /add column if not exists phone_verified_at/);
  assert.match(migration, /add column if not exists user_id/);
});
