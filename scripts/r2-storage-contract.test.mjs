import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, root), "utf8");

test("R2 presigned PUT signs Content-Type", () => {
  const source = read("src/lib/storage/s3.server.ts");
  assert.match(source, /content-type;host/);
  assert.match(source, /content-length/);
  assert.match(source, /sizeBytes/);
  assert.match(source, /560 \* 1024/);
  assert.match(source, /content-type:\$\{canonicalHeaderValue\(contentType\)\}/);
  assert.match(source, /assertContentType\(input\.contentType\)/);
  assert.match(source, /signedHeaders = "host;x-amz-content-sha256;x-amz-date"/);
  assert.match(source, /SignedHeaders=\$\{signedHeaders\}/);
});

test("R2 bucket/account validation matches Cloudflare naming requirements", () => {
  const source = read("src/lib/storage/s3.server.ts");
  assert.match(source, /\^\[a-z0-9\]\(\?:\[a-z0-9-\]\{1,61\}\[a-z0-9\]\)\?\$/);
  assert.match(read("src/lib/storage/r2.server.ts"), /\^\[a-f0-9\]\{32\}\$/i);
});

test("storage upload endpoint is rate limited per authenticated user", () => {
  const source = read("src/lib/storage/storage.ts");
  assert.match(source, /enforceRateLimit\("storage-upload-url"/);
  assert.match(source, /maxRequests: 20/);
  assert.match(source, /subject: userId/);
});

test("storage never exposes R2 credentials to browser code", () => {
  const source = read("src/lib/storage/storage.ts");
  assert.doesNotMatch(source, /CLOUDFLARE_R2_SECRET_ACCESS_KEY/);
  assert.doesNotMatch(source, /CLOUDFLARE_R2_ACCESS_KEY_ID/);
});
