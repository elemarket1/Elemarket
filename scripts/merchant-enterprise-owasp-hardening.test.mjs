import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("enterprise credential mode changes fail closed and cannot reuse old credentials", () => {
  const source = read("src/lib/market/enterprise-catalog.server.ts");
  assert.match(source, /authTypeChanged/);
  assert.match(source, /New credentials are required when changing enterprise authentication type/);
  assert.match(source, /Never carry credentials across an authentication-mode transition/);
});

test("enterprise order endpoints are SSRF-validated when configured", () => {
  const source = read("src/lib/market/enterprise-catalog.server.ts");
  assert.match(source, /if \(input\.orderEndpointUrl\) await validateEndpoint\(input\.orderEndpointUrl\)/);
});

test("enterprise credential changes require a fresh authenticated session", () => {
  const source = read("src/routes/merchant/dashboard.functions.ts");
  assert.match(source, /import \{ requireFreshSession \}/);
  assert.match(source, /await requireFreshSession\(\);return saveEnterpriseCatalogConnection/);
});

test("merchant enterprise UI does not render raw upstream/internal error strings", () => {
  const source = read("src/routes/merchant/dashboard.tsx");
  assert.doesNotMatch(source, /String\(x\.last_error\)/);
  assert.doesNotMatch(source, /String\(x\.error_message\)/);
  assert.match(source, /error_code/);
  assert.match(source, /replaceAll\("_"," "\)/);
});

test("merchant enterprise operational API returns bounded error codes instead of raw failure text", () => {
  const source = read("src/routes/merchant/dashboard.functions.ts");
  assert.match(source, /case when error_count > 0 then 'SYNC_FAILED'/);
  assert.match(source, /case when last_error is not null then 'WEBHOOK_PROCESSING_FAILED'/);
  assert.match(source, /case when last_error is not null then 'ORDER_DELIVERY_FAILED'/);
});
