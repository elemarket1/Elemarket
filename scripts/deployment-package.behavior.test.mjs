import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

test("deployment package validates migration set and auth source/copy", () => {
  const output = execFileSync(process.execPath, ["scripts/validate-deployment-package.mjs"], { encoding: "utf8" });
  assert.match(output, /deployment-package.*valid/i);
});

test("mobile EAS profiles do not hardcode the marketplace API origin", () => {
  const eas = JSON.parse(readFileSync("mobile/eas.json", "utf8"));
  for (const profile of Object.values(eas.build ?? {})) {
    assert.equal(profile.env?.EXPO_PUBLIC_API_BASE_URL, undefined);
  }
  assert.match(readFileSync("mobile/src/auth.ts", "utf8"), /EXPO_PUBLIC_API_BASE_URL/);
});
