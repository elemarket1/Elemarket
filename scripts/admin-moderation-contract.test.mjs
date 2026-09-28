import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read=(p)=>fs.readFileSync(p,"utf8");

test("admin moderation controls are server-authorized and reason-bound",()=>{
 const server=read("src/routes/admin/moderation.functions.ts");
 assert.match(server,/requireAdminForUserId/);
 assert.match(server,/requireFreshSession/);
 assert.match(server,/reason:z\.string\(\)\.min\(3\)/);
 assert.match(server,/admin_set_merchant_status/);
 assert.match(server,/admin_set_customer_blacklist/);
});

test("admin moderation migration is non-destructive and auditable",()=>{
 const migration=read("migrations/0048_admin_moderation_controls.sql");
 assert.match(migration,/moderationStatus/);
 assert.match(migration,/admin_moderation_actions/);
 assert.match(migration,/record_audit_event/);
 assert.doesNotMatch(migration,/delete from merchants/i);
 assert.doesNotMatch(migration,/delete from "user"/i);
});

test("admin UI exposes merchant suspension and customer blacklist controls",()=>{
 const ui=read("src/routes/admin/dashboard.tsx");
 assert.match(ui,/Suspend merchant/);
 assert.match(ui,/Reinstate/);
 assert.match(ui,/Blacklist customer/);
 assert.match(ui,/Reinstate customer/);
});
