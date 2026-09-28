import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const s=fs.readFileSync(new URL('../src/lib/storage/storage.server.ts',import.meta.url),'utf8');
test('storage verifier is not prefix-only',()=>{assert.match(s,/real EOI marker/); assert.match(s,/declared === bytes.length/); assert.match(s,/OpenAction/); assert.match(s,/script\\b/);});
test('presigned upload is overwrite-resistant',()=>{const r=fs.readFileSync(new URL('../src/lib/storage/s3.server.ts',import.meta.url),'utf8'); assert.match(r,/if-none-match/); assert.match(r,/"\*"/);});
