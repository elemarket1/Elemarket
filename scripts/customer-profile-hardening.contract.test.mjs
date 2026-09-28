import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("../", import.meta.url);
const read = (file) => fs.readFileSync(new URL(file, root), "utf8");

test("customer profile never accepts browser-supplied coordinates", () => {
  const web = read("src/lib/auth/account.functions.ts");
  const mobile = read("src/routes/api.mobile.profile.ts");
  assert.doesNotMatch(web, /lat:\s*z\.number/);
  assert.doesNotMatch(web, /lon:\s*z\.number/);
  assert.doesNotMatch(mobile, /lat:\s*z\.number/);
  assert.doesNotMatch(mobile, /lon:\s*z\.number/);
  assert.match(web, /lat=null/);
  assert.match(web, /lon=null/);
  assert.match(mobile, /lat=null/);
  assert.match(mobile, /lon=null/);
});

test("customer profile APIs do not expose cached coordinates", () => {
  const web = read("src/lib/auth/account.functions.ts");
  const mobile = read("src/routes/api.mobile.me.ts");
  assert.doesNotMatch(web, /p\.lat|p\.lon/);
  assert.doesNotMatch(mobile, /p\.lat|p\.lon/);
});

test("merchant registration and reset-password UI match the 12-character server policy", () => {
  const merchant = read("src/routes/merchant/register.tsx");
  const reset = read("src/routes/reset-password.tsx");
  assert.match(merchant, /type="password" minLength=\{12\}/);
  assert.match(reset, /newPassword\.length < 12/);
  assert.match(reset, /minLength=\{12\}/);
  assert.match(reset, /at least 12 characters/);
});
