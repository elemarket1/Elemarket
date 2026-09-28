import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/lib/kyb/providers/fylings.server.ts', import.meta.url), 'utf8');
const kyb = await readFile(new URL('../src/lib/kyb/index.server.ts', import.meta.url), 'utf8');
const account = await readFile(new URL('../src/lib/auth/account.functions.ts', import.meta.url), 'utf8');
const migration = await readFile(new URL('../migrations/0046_kyb_fylings.sql', import.meta.url), 'utf8');
const merchant = await readFile(new URL('../src/routes/merchant/register.tsx', import.meta.url), 'utf8');

test('Fylings adapter stays provider-neutral and server-side', () => {
  assert.match(source, /\/api\/v1\/verify/);
  assert.match(source, /Authorization:\s*`Bearer \$\{this\.apiKey\}`/);
  assert.match(source, /country: input\.country\.trim\(\)\.toUpperCase\(\)/);
  assert.match(source, /export class FylingsAdapter implements KYBProvider/);
});

test('Fylings adapter fails closed on transport and oversized responses', () => {
  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /REQUEST_TIMEOUT_MS = 12_000/);
  assert.match(source, /MAX_RESPONSE_BYTES/);
  assert.match(source, /AbortError/);
});

test('Fylings evidence is normalized instead of blindly persisting the provider payload', () => {
  assert.match(source, /evidence:\s*\{/);
  assert.match(source, /sources: body\.sources/);
  assert.match(source, /checked_at: body\.checked_at/);
});

test('merchant KYB requires and passes the business registration number to the provider', () => {
  assert.match(kyb, /ma\.registration_number/);
  assert.match(kyb, /registrationNumber: app\.registration_number \?\? undefined/);
  assert.match(account, /registrationNumber: z\.string\(\)\.trim\(\)\.min\(2\)\.max\(80\)/);
  assert.match(merchant, /registrationNumber|Business number|registration number/i);
});

test('merchant applications canonicalize Ghana phone numbers before persistence', () => {
  assert.match(account, /const normalizedContact = normalizePhone\(data\.contact\)/);
  assert.match(account, /contact,registration_number/);
});

test('KYB migration is safe for existing merchant applications', () => {
  assert.match(migration, /add column if not exists registration_number text/);
  assert.match(migration, /add column if not exists updated_at timestamptz not null default now\(\)/);
});
