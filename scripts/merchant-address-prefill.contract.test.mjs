import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../src/routes/merchant/register.tsx", import.meta.url),
  "utf8",
);

test("merchant registration never lets late prefill responses overwrite typed address", () => {
  assert.match(
    source,
    /setAddress\(\(current\) => current \|\| profile\.address \|\| ""\)/,
  );
});

test("merchant registration uses empty-field guards for async customer prefills", () => {
  assert.match(source, /setName\(\(current\) => current \|\|/);
  assert.match(source, /setPhone\(\(current\) => current \|\|/);
});
