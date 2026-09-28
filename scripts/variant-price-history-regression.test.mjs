import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url).pathname;
const read = (p) => fs.readFileSync(root + p, 'utf8');

test('variant price-history trigger never reads currency from product_variants', () => {
  const files = [
    'migrations/0064_flash_sales_price_history_hardening.sql',
    'migrations/0069_variant_price_history_fix.sql',
    'migrations/0076_variant_price_history_currency_forward_fix.sql',
    'migrations/0079_variant_price_history_trigger_final_repair.sql',
  ];
  for (const file of files) {
    const sql = read(file);
    assert.doesNotMatch(sql, /record_variant_price_history[\s\S]*new\.currency/);
  }
});

test('canonical variant history trigger resolves currency from products', () => {
  const sql = read('migrations/0079_variant_price_history_trigger_final_repair.sql');
  assert.match(sql, /insert into variant_price_history\([\s\S]*currency/);
  assert.match(sql, /new\.price,\s*p\.currency,\s*now\(\)/);
  assert.match(sql, /from products p/);
  assert.match(sql, /where p\.id = new\.product_id/);
});

test('forward repair recreates the trigger on the actual product_variants table', () => {
  const sql = read('migrations/0079_variant_price_history_trigger_final_repair.sql');
  assert.match(sql, /drop trigger if exists variant_price_history_capture on product_variants/);
  assert.match(sql, /create trigger variant_price_history_capture/);
  assert.match(sql, /after insert or update of price on product_variants/);
});
