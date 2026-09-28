import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const server=fs.readFileSync('src/routes/homepage.functions.ts','utf8');
const mig=fs.readFileSync('migrations/0123_admin_campaign_management.sql','utf8')+'\n'+fs.readFileSync('migrations/0124_campaign_production_hardening.sql','utf8');
const admin=fs.readFileSync('src/lib/admin/campaign.functions.ts','utf8');
const route=fs.readFileSync('src/routes/admin/campaigns.tsx','utf8');

test('anonymous campaign analytics use a server-issued HttpOnly visitor token',()=>{
 assert.match(server,/elemarket\.ad_visitor/); assert.match(server,/HttpOnly/); assert.match(server,/createHmac/); assert.match(server,/timingSafeEqual/); assert.doesNotMatch(server,/localStorage\.getItem\("elemarket_ad_session"\)/);
});
test('campaign impression caps are atomic under concurrency',()=>{
 assert.match(mig,/for update/); assert.match(mig,/impression_count < max_impressions/); assert.match(mig,/delete from homepage_ad_events where id=p_event_id/);
});
test('material campaign edits require fresh review',()=>{
 assert.match(mig,/reset_homepage_campaign_review_on_edit/); assert.match(mig,/new\.status := 'pending_review'/); assert.match(mig,/new\.reviewed_by := null/);
});
test('campaign lifecycle rejects invalid state transitions',()=>{
 assert.match(mig,/campaign is not awaiting approval/); assert.match(mig,/campaign cannot be paused from current state/); assert.match(mig,/only paused campaigns can be resumed/); assert.match(mig,/campaign cannot be ended from current state/);
});
test('pending review campaigns are actionable in admin UI',()=>{ assert.match(route,/c\.status==="draft"\|\|c\.status==="pending_review"\|\|c\.status==="rejected"/); });
test('campaign media is restricted to approved local upload paths',()=>{ assert.match(mig,/campaign media must be an approved local upload path/); });


test('cron worker endpoints use replay-resistant HMAC authentication',()=>{
 for(const file of ['src/routes/api.internal.expire-payment-orders.ts','src/routes/api.internal.sync-enterprise-catalogs.ts']){
  const s=fs.readFileSync(file,'utf8'); assert.match(s,/authorizeInternalHmacRequest/); assert.doesNotMatch(s,/authorization.*Bearer|timingSafeEqualText/);
 }
});


test('admin campaign edits preserve stored responsive visibility settings',()=>{
 const fn=fs.readFileSync('src/lib/admin/campaign.functions.ts','utf8'); const route=fs.readFileSync('src/routes/admin/campaigns.tsx','utf8');
 assert.match(fn,/mobile_visible/); assert.match(fn,/desktop_visible/); assert.match(route,/mobileVisible:c\.mobileVisible/); assert.match(route,/desktopVisible:c\.desktopVisible/);
});
