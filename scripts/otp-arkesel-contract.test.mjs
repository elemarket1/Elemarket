import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const provider = fs.readFileSync("src/lib/auth/otp/providers/arkesel.server.ts", "utf8");
const registry = fs.readFileSync("src/lib/auth/otp/registry.server.ts", "utf8");
const core = fs.readFileSync("src/lib/auth/otp/otp.server.ts", "utf8");
const api = fs.readFileSync("src/lib/auth/otp.ts", "utf8");
const migration = fs.readFileSync("migrations/0039_otp_arkesel.sql", "utf8");
const checkout = fs.readFileSync("src/routes/checkout.tsx", "utf8");

test("Arkesel adapter uses the documented OTP endpoints and server-side api-key", () => {
  assert.match(provider, /https:\/\/sms\.arkesel\.com\/api\/otp/);
  assert.match(provider, /api-key/);
  assert.match(provider, /post\("generate"/);
  assert.match(provider, /post\("verify"/);
  assert.match(provider, /medium: "sms"/);
  assert.match(provider, /type: "numeric"/);
  assert.match(provider, /String\(code\) === "1000"/);
  assert.match(provider, /case "1100"/);
  assert.match(provider, /case "1104"/);
  assert.match(provider, /case "1105"/);
  assert.doesNotMatch(provider, /VITE_ARKESEL_API_KEY/);
});

test("OTP provider selection remains deployment-configured", () => {
  assert.match(registry, /ELEMARKET_OTP_PROVIDER/);
  assert.match(registry, /selected === "arkesel"/);
});

test("OTP core enforces lifecycle controls", () => {
  assert.match(core, /MAX_ATTEMPTS = 5/);
  assert.match(core, /RESEND_COOLDOWN_SECONDS = 60/);
  assert.match(core, /expires_at > now\(\)/);
  assert.match(core, /attempts < max_attempts/);
  assert.match(core, /status='verified'/);
  assert.match(core, /status = 'superseded'/);
  assert.match(core, /enforceRateLimit\("otp-request"/);
  assert.match(core, /enforceRateLimit\("otp-verify"/);
  assert.doesNotMatch(core, /otp.*value.*insert/i);
});

test("OTP server-function boundary does not statically import server implementation", () => {
  assert.doesNotMatch(api, /from ["']\.\/otp\/otp\.server["']/);
  assert.match(api, /await import\("\.\/otp\/otp\.server"\)/);
  assert.match(api, /purpose: z\.enum\(\["signup", "login", "phone_verification", "password_reset", "transactional"\]\)/);
});

test("OTP migration has one active challenge and no plaintext OTP column", () => {
  assert.match(migration, /create table if not exists otp_challenges/);
  assert.match(migration, /otp_challenges_one_pending_uq/);
  assert.match(migration, /where status = 'pending'/);
  assert.doesNotMatch(migration, /otp(_| )code|otp_value|code text/i);
});

test("checkout fingerprint is not a client-only route import", () => {
  assert.match(checkout, /from "@\/lib\/market\/checkout-fingerprint"/);
  assert.doesNotMatch(checkout, /from "@\/lib\/market\/checkout\.client"/);
});
