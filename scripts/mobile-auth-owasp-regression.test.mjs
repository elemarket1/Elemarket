import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const verify = fs.readFileSync('src/lib/auth/verify.server.ts', 'utf8');
const mobileAuth = fs.readFileSync('mobile/src/auth.ts', 'utf8');
const server = fs.readFileSync('src/lib/auth/server.ts', 'utf8');

test('mobile fresh-session checks accept bearer authentication, not cookie-only state', () => {
  assert.match(verify, /auth\.api\.getSession\(\{ headers: request\.headers \}\)/);
  assert.match(verify, /request\.headers/);
  assert.match(verify, /Bearer\\s\+/i);
});

test('mobile credentials remain device-secure and are never stored in browser storage', () => {
  assert.match(mobileAuth, /expo-secure-store/);
  assert.match(mobileAuth, /WHEN_UNLOCKED_THIS_DEVICE_ONLY/);
  assert.doesNotMatch(mobileAuth, /AsyncStorage|localStorage|sessionStorage/);
});

test('Better Auth bearer support remains enabled', () => {
  assert.match(server, /bearer\(\)/);
});
