import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root,p),'utf8');

test('financing schema is provider-neutral', () => {
  const sql = read('migrations/0026_neutral_financing_provider.sql');
  assert.match(sql, /contribution_basis/);
  assert.match(sql, /delete from financing_providers/i);
});

test('financing engine contains no provider-specific customer logic', () => {
  const src = read('src/lib/market/financing.ts');
  assert.doesNotMatch(src, /motito|paysmall|hubtel|paystack/i);
  assert.match(src, /financing_providers/);
});
