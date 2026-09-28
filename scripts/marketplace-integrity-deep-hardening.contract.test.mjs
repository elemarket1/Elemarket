import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const m=fs.readFileSync(path.join(process.cwd(),'migrations/0107_marketplace_integrity_deep_hardening.sql'),'utf8');
test('order graph integrity binds group customer and delivery quote merchant/customer',()=>{
 assert.match(m,/validate_order_graph_integrity/); assert.match(m,/v_group_user<>new.user_id/); assert.match(m,/v_quote\.merchant_id<>new\.merchant_id/);
});
test('order items cannot cross merchant or variant boundaries',()=>{assert.match(m,/validate_order_item_graph_integrity/);assert.match(m,/v_product_merchant<>v_order_merchant/);assert.match(m,/v_variant_product<>new\.product_id/)});
test('payments cannot cross customer/order/amount/currency boundaries',()=>{assert.match(m,/validate_payment_graph_integrity/);assert.match(m,/v_order\.user_id<>new\.user_id/);assert.match(m,/round\(new\.amount,2\)<>round\(v_order\.grand_total,2\)/)});
test('merchant and admin database functions enforce actor classes',()=>{assert.match(m,/merchant_adjust_inventory[\s\S]*perform assert_actor_role\(p_actor_user_id,'merchant'\)/);assert.match(m,/merchant_advance_order[\s\S]*perform assert_actor_role\(p_actor_user_id,'merchant'\)/);assert.match(m,/admin_set_product_status[\s\S]*perform assert_actor_role\(p_admin_id,'admin'\)/);assert.match(m,/admin_set_merchant_status[\s\S]*perform assert_actor_role\(p_admin_id,'admin'\)/)});

const latest=fs.readFileSync(path.join(process.cwd(),'migrations/0125_production_actor_and_cron_hardening.sql'),'utf8')
  + '\n' + fs.readFileSync(path.join(process.cwd(),'migrations/0126_repair_merchant_actor_role_membership.sql'),'utf8');
test('latest merchant DB mutations bind actor to active merchant membership',()=>{
 assert.match(latest,/create or replace function assert_merchant_actor/);
 assert.match(latest,/v_role not in \('customer','merchant'\)/);
 assert.match(latest,/ma\.merchant_id=p_merchant_id/);
 assert.match(latest,/ma\.user_id=p_actor_user_id/);
 assert.match(latest,/ma\.status='active'/);
 assert.match(latest,/merchant_adjust_inventory[\s\S]*perform assert_merchant_actor\(p_actor_user_id,p_merchant_id\)/);
 assert.match(latest,/merchant_advance_order[\s\S]*perform assert_merchant_actor\(p_actor_user_id,p_merchant_id\)/);
});
