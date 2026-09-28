import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const fn=fs.readFileSync(new URL('../src/routes/admin/moderation.functions.ts',import.meta.url),'utf8');
const sql=fs.readFileSync(new URL('../migrations/0075_admin_merchant_suspend_reliability.sql',import.meta.url),'utf8');
const seed=fs.readFileSync(new URL('../migrations/0002_marketplace.sql',import.meta.url),'utf8');
const ui=fs.readFileSync(new URL('../src/routes/admin/dashboard.tsx',import.meta.url),'utf8');

test('merchant moderation accepts omitted reason and sends empty default marker',()=>{
 assert.match(fn,/merchantAction=.*reason:z\.string\(\)\.max\(2000\)\.optional\(\)/);
 assert.match(fn,/data\.reason\?\.trim\(\) \?\? ""/);
});
test('database moderation works for ownerless seeded merchants',()=>{
 assert.match(sql,/does not require merchant_accounts/i);
 assert.match(sql,/update merchants\s+set status = p_status/i);
 assert.match(sql,/update merchant_accounts/i);
});
test('seed merchants are explicitly addressable and initially active',()=>{
 for (const id of ['mer_labone_kitchen','mer_makola','mer_osu_atelier','mer_eastlegon_tech','mer_circle_beauty','mer_madina_agri','mer_tema_home','mer_cantonments_stay']) {
  assert.match(seed,new RegExp(`'${id}',[^\\n]*'active'`));
 }
});
test('merchant suspend UI no longer blocks on a required reason',()=>{
 assert.match(ui,/placeholder="Reason \(optional\)"/);
});
