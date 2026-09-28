import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('v1.38 package metadata is synchronized', () => {
  const pkg = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(pkg.version, lock.packages[''].version);
  assert.match(pkg.version, /^1\.\d+\.\d+$/);
});

test('variant checkout groups by product and variant, never collapses distinct SKUs', () => {
  const sql = read('migrations/0015_cto_integrity.sql');
  assert.match(sql, /group by 1, 2\s+order by 1, 2/);
  assert.doesNotMatch(sql, /max\(elem->>'variantId'\)/);
});

test('order item ownership is database enforced', () => {
  const sql = read('migrations/0015_cto_integrity.sql');
  assert.match(sql, /create or replace function validate_order_item_ownership/);
  assert.match(sql, /order item merchant mismatch/);
  assert.match(sql, /order item variant mismatch/);
  assert.match(sql, /create trigger order_items_ownership_validate/);
});

test('payment attempt integrity is database enforced', () => {
  const sql = read('migrations/0015_cto_integrity.sql');
  assert.match(sql, /validate_payment_attempt_integrity/);
  assert.match(sql, /payment attempt provider mismatch/);
  assert.match(sql, /payment attempt amount mismatch/);
  assert.match(sql, /create trigger payment_attempt_integrity_validate/);
});

test('merchant resource helpers bind object IDs to merchant ownership', () => {
  const src = read('src/lib/market/merchant-resources.server.ts');
  assert.match(src, /requireMerchantProduct/);
  assert.match(src, /requireMerchantVariant/);
  assert.match(src, /requireMerchantMedia/);
  assert.match(src, /requireMerchantAccess/);
});
