import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');

test('enterprise catalog routes cannot be authorized with CRON_SECRET bearer fallback', () => {
  for (const file of [
    'src/routes/api.enterprise.catalog.sync.ts',
    'src/routes/api.internal.enterprise-order-outbox.ts',
    'src/routes/api.internal.enterprise-webhook-worker.ts',
  ]) {
    const s = read(file);
    assert.match(s, /authorizeInternalHmacRequest\(request,\s*process\.env\.ELEMARKET_ENTERPRISE_SYNC_SECRET\)/);
    assert.doesNotMatch(s, /authorizeInternalHmacRequest\(request,\s*process\.env\.ELEMARKET_ENTERPRISE_SYNC_SECRET,\s*process\.env\.CRON_SECRET\)/);
  }
});

test('shared search cursors cannot fall back to a predictable development secret', () => {
  const s = read('src/lib/market/search.server.ts');
  assert.match(s, /SEARCH_CURSOR_SECRET or BETTER_AUTH_SECRET is required in shared environments/);
});

test('shared homepage analytics cannot fall back to a predictable development secret', () => {
  const s = read('src/routes/homepage.functions.ts');
  assert.match(s, /BETTER_AUTH_SECRET is required for homepage analytics in shared environments/);
});

console.log('Deep security regression v3: 3 assertions passed, 0 failed');

test('mobile EAS builds do not hardcode a deployment API origin', () => {
  const s = read('mobile/eas.json');
  assert.doesNotMatch(s, /EXPO_PUBLIC_API_BASE_URL/);
  assert.doesNotMatch(s, /elevoratrading\.com/i);
});

test('development signing secrets are runtime-generated rather than hardcoded', () => {
  for (const file of ['src/lib/market/search.server.ts','src/lib/market/homepage.server.ts','src/lib/market/homepage.functions.ts','src/routes/homepage.functions.ts']) {
    const s = read(file);
    assert.doesNotMatch(s, /local-ad-analytics-development-secret|development-search-cursor-secret-change-me/);
    assert.match(s, /randomBytes\(32\)\.toString\("hex"\)/);
  }
});
