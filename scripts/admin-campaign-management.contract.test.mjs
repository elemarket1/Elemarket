import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const route=fs.readFileSync('src/routes/admin/campaigns.tsx','utf8');
const fn=fs.readFileSync('src/lib/admin/campaign.functions.ts','utf8');
const mig=fs.readFileSync('migrations/0123_admin_campaign_management.sql','utf8');
const home=fs.readFileSync('src/routes/homepage.functions.ts','utf8');

test('admin campaign management is server-authorized and fresh-session protected',()=>{
 assert.match(fn,/requireAdminForUserId\(adminId\)/); assert.match(fn,/requireFreshSession\(\)/); assert.match(fn,/enforceRateLimit\("admin-homepage-campaign-(create|update|status)"/);
});
test('campaign lifecycle is database-controlled',()=>{
 assert.match(mig,/admin_set_homepage_campaign_status/); assert.match(mig,/for update/); assert.match(mig,/version=version\+1/); assert.match(mig,/campaign changed; refresh and retry/);
});
test('food spotlight is restricted to product destinations',()=>{
 assert.match(fn,/food_spotlight.*destination\.type!=="product"/); assert.match(mig,/food spotlight requires a product destination/); assert.match(home,/c\.placement <> 'food_spotlight' or p\.listing_type='food'/);
});
test('public homepage excludes unapproved or expired campaigns',()=>{
 assert.match(home,/c\.status in \('active','scheduled'\)/); assert.match(home,/c\.starts_at<=now\(\)/); assert.match(home,/c\.ends_at>now\(\)/);
});
test('campaign UI exposes lifecycle and performance controls',()=>{
 assert.match(route,/Create campaign/); assert.match(route,/Approve/); assert.match(route,/Pause/); assert.match(route,/Resume/); assert.match(route,/CTR/); assert.match(route,/Campaign Manager/);
});
test('campaign creative rejects external media',()=>{ assert.match(mig,/external campaign media is not allowed/); });
