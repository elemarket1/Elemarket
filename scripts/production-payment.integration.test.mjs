import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { createHmac } from 'node:crypto';
import { createPaymentFixture } from './helpers/payment-fixture.mjs';
import { loadTypeScript } from './helpers/load-typescript.mjs';
const enabled=process.env.RUN_DB_INTEGRATION==='1' && !!process.env.ELEMARKET_INTEGRATION_DATABASE_URL;
const pool=enabled ? new Pool({connectionString:process.env.ELEMARKET_INTEGRATION_DATABASE_URL}) : null;
after(()=>pool?.end());
const errors=loadTypeScript('src/lib/market/payment-errors.ts');
const {PaystackPaymentAdapter}=loadTypeScript('src/lib/market/adapters/providers/paystack.ts',{'@/lib/market/payment-errors':errors});
const secret='synthetic-contract-secret';
function integration(name,fn){test(name,{skip:!enabled?'Disposable PostgreSQL required':false},fn)}
const query=async(s,p)=>(await pool.query(s,p)).rows;
async function fixture(){const ids=await createPaymentFixture(query,{driverKey:'paystack'});await query("insert into merchant_payment_accounts(id,merchant_id,provider_key,provider_account_ref,status) values($1,$2,$3,'ACCT_fixture','active')",['acct_'+ids.payment,ids.merchant,ids.provider]);return ids;}
function runtime(ids,t,{refundStatus='processed',initializationTimeout=false}={}){
  let creates=0,refunds=0; const adapter=new PaystackPaymentAdapter(secret);
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    if(url.endsWith('/transaction/initialize')) {creates++; if(initializationTimeout)throw new Error('provider initialization timeout'); const body=JSON.parse(options.body);assert.equal(body.subaccount,'ACCT_fixture');return Response.json({status:true,data:{reference:body.reference,authorization_url:'https://checkout.paystack.com/fixture'}})}
    if(url.includes('/transaction/verify/'))return Response.json({status:true,data:{status:'success',reference:decodeURIComponent(url.split('/').pop()),amount:10000,currency:'GHS'}});
    if(url.endsWith('/refund')){refunds++;return Response.json({status:true,data:{id:54321,status:refundStatus,amount:10000,transaction:{reference:JSON.parse(options.body).transaction}}})}
    throw new Error('Unexpected provider endpoint');
  });
  const registry={getPaymentAdapter:async(_key,driver)=>{assert.equal(driver,'paystack');return adapter}};
  const refundModule=loadTypeScript('src/lib/market/refunds.server.ts',{
    '@/lib/db':{getSql:async()=>({query})},'@/lib/market/adapters/registry':registry,
    '@/lib/observability/logger.server':{recordMetric:async()=>{}},'@/lib/auth/verify.server':{requireFreshSession:async()=>ids.user},
    '@/lib/auth/authorization.server':{requireAdminForUserId:async()=>{assert.equal((await query('select role from "user" where id=$1',[ids.user]))[0].role,'admin')}},
  });
  const payment=loadTypeScript('src/lib/market/payment.server.ts',{
    '@/lib/db':{getSql:async()=>({query:async(s,p)=>s.includes("where status='active'\n      order by provider_key") ? query("select provider_key,driver_key from payment_providers where provider_key=$1",[ids.provider]):query(s,p)})},
    '@/lib/market/ownership.server':{requireCustomerPayment:async(id,user)=>{const rows=await query('select * from payments where id=$1 and user_id=$2',[id,user]);if(!rows[0])throw new Error('not owned');return rows[0]}},
    '@/lib/market/adapters/registry':registry,'@/lib/market/refunds.server':refundModule,
    '@/lib/observability/logger.server':{recordMetric:async()=>{}},'@/lib/observability/security-alert.server':{emitSecurityAlert:async()=>{}},
    '@/lib/security/rate-limit.server':{enforceRateLimit:async()=>{}},'@/lib/market/provider-policy.server':{normalizeProviderKey:x=>x},
    '@/lib/env.server':{env:()=>undefined,getElemarketEnvironment:()=> 'staging'},'@/lib/market/payment-errors':errors,
  });
  const webhookRoute=loadTypeScript('src/routes/api.payments.webhook.ts',{
    '@tanstack/react-router':{createFileRoute:()=>config=>config},
    '@/lib/market/payment.server':payment,
    '@/lib/security/body.server':loadTypeScript('src/lib/security/body.server.ts'),
    '@/lib/market/payment-errors':errors,
    '@/lib/security/rate-limit.server':{enforceRateLimit:async()=>{},rateLimitResponse:()=>null},
  }).Route.server.handlers.POST;
  process.env[`ELEMARKET_PAYMENT_${ids.provider.toUpperCase().replace(/[^A-Z0-9]+/g,'_')}_CHECKOUT_HOSTS`]='checkout.paystack.com';
  return {payment,refundModule,counts:()=>({creates,refunds}),init:()=>payment.createExternalPaymentIntent({paymentId:ids.payment,userId:ids.user}),
    webhook:async(reference,overrides={})=>{const rawBody=JSON.stringify({event:'charge.success',data:{id:123456,reference,amount:10000,currency:'GHS',...overrides}});const response=await webhookRoute({request:new Request('https://example.invalid/api/payments/webhook',{method:'POST',headers:{'x-elemarket-provider':ids.provider,'x-paystack-signature':createHmac('sha512',secret).update(rawBody).digest('hex')},body:rawBody})}); if(!response.ok)throw new Error('Webhook rejected '+response.status);return (await response.json()).result}};
}
async function state(ids){return (await query('select o.status order_status,p.status payment_status from orders o join payments p on p.order_id=o.id where p.id=$1',[ids.payment]))[0]}
async function cancel(ids){return query("with identity as (select set_config('app.user_id',$1,true)) select release_order_stock($2,$1) from identity",[ids.user,ids.order])}
integration('numeric Paystack webhook -> evidence -> paid; duplicate idempotent; wrong data rejected',async t=>{
 const ids=await fixture(),r=runtime(ids,t),intent=await r.init();
 for(const overrides of [{amount:9999},{currency:'USD'},{reference:'wrong-order'},{id:{}}])await assert.rejects(()=>r.webhook(intent.providerReference,overrides));
 assert.equal((await state(ids)).order_status,'payment_pending');
 await r.webhook(intent.providerReference);assert.equal((await state(ids)).order_status,'paid');
 assert.equal((await r.webhook(intent.providerReference)).duplicate,true);
 assert.equal((await query('select * from payment_provider_evidence where payment_id=$1',[ids.payment])).length,1);
 assert.deepEqual(r.counts(),{creates:1,refunds:0});
});
integration('cancelled order cannot initialize Paystack; ownership and merchant refund bindings fail closed',async t=>{
 const ids=await fixture(),r=runtime(ids,t);await cancel(ids);await assert.rejects(r.init,/eligible/);assert.equal(r.counts().creates,0);
 await assert.rejects(()=>r.payment.createExternalPaymentIntent({paymentId:ids.payment,userId:'wrong-account'}),/owned/);
 const other=await fixture();
 await assert.rejects(()=>query("insert into provider_refund_requests(id,payment_id,order_id,provider_key,provider_reference,amount,currency) values('wrong-'||$1,$1,$2,$3,'wrong',100,'GHS')",[ids.payment,other.order,ids.provider]),/binding/);
});
integration('concurrent cancel and initialization serialize to one consistent state',async t=>{
 const ids=await fixture(),r=runtime(ids,t);
 const results=await Promise.allSettled([cancel(ids),r.init()]);const s=await state(ids);
 if(s.order_status==='cancelled'){assert.equal(results[1].status,'rejected');assert.equal(r.counts().creates,0)}
 else{assert.equal(s.order_status,'payment_pending');assert.equal(results[0].status,'rejected');assert.equal(r.counts().creates,1)}
});
integration('concurrent payment initialization issues exactly one provider transaction',async t=>{
 const ids=await fixture(),r=runtime(ids,t);await Promise.all([r.init(),r.init(),r.init()]);assert.equal(r.counts().creates,1);
});
integration('expiry releases stock, invalidates attempts; late success refunds once without fulfillment',async t=>{
 const ids=await fixture(),r=runtime(ids,t),intent=await r.init();
 await query("update orders set payment_deadline=now()-interval '1 second' where id=$1",[ids.order]);
 await assert.rejects(r.init,/eligible/);
 // Webhook itself detects expiry even if cron has not run.
 await r.webhook(intent.providerReference);await r.webhook(intent.providerReference);
 assert.deepEqual(await state(ids),{order_status:'cancelled',payment_status:'refunded'});assert.equal(r.counts().refunds,1);
 assert.equal((await query('select status from order_stock_reservations where order_id=$1',[ids.order]))[0].status,'released');
 assert.equal((await query('select status from payment_attempts where payment_id=$1',[ids.payment]))[0].status,'cancelled');
 assert.equal((await query('select merchant_order_withdrawal_eligibility($1,$2) result',[ids.merchant,ids.order]))[0].result.eligible,false);
 assert.equal((await query('select id from marketplace_reconciliation_cases where order_id=$1',[ids.order])).length,1);
});
integration('customer cancellation refund uses owning driver and finalizes order/payment exactly once',async t=>{
 const ids=await fixture(),r=runtime(ids,t),intent=await r.init();await r.webhook(intent.providerReference);
 const prepared=(await query('select prepare_provider_refund_for_payment($1,$2,$3) result',[ids.payment,ids.user,'cancel']))[0].result;
 await Promise.all([r.refundModule.executeProviderRefundAsAuthenticatedUser(prepared.requestId),r.refundModule.executeProviderRefundAsAuthenticatedUser(prepared.requestId)]);
 assert.equal(r.counts().refunds,1);assert.deepEqual(await state(ids),{order_status:'refunded',payment_status:'refunded'});
});
integration('customer dispute -> authorized admin -> provider refund -> resolved dispute',async t=>{
 const ids=await fixture(),r=runtime(ids,t),intent=await r.init();await r.webhook(intent.providerReference);
 const dispute=(await query('select open_customer_order_dispute($1,$2,$3) result',[ids.order,ids.user,'Goods differ from listing']))[0].result;
 await assert.rejects(()=>query('select prepare_provider_refund_for_dispute($1,$2,$3)',[dispute.disputeId,ids.user,'approved']),/admin required/);
 await query('update "user" set role=\'admin\' where id=$1',[ids.user]);
 const prepared=(await query('select prepare_provider_refund_for_dispute($1,$2,$3) result',[dispute.disputeId,ids.user,'approved']))[0].result;
 await r.refundModule.executeProviderRefundAsAdmin(prepared.requestId);
 assert.equal((await query('select status from customer_order_disputes where id=$1',[dispute.disputeId]))[0].status,'resolved_refund');
 assert.deepEqual(await state(ids),{order_status:'refunded',payment_status:'refunded'});assert.equal(r.counts().refunds,1);
});

integration('late charge pending provider refund is never reported as a payable or fulfilled order',async t=>{
 const ids=await fixture(),r=runtime(ids,t,{refundStatus:'processing'}),intent=await r.init();
 await query("update orders set payment_deadline=now()-interval '1 second' where id=$1",[ids.order]);
 await r.webhook(intent.providerReference);
 const {customerPaymentOutcome}=loadTypeScript('src/lib/market/payment-status.server.ts',{'@/lib/db':{getSql:async()=>({query})}});
 assert.equal((await customerPaymentOutcome(ids.payment,ids.user)).status,'reconciliation_required');
 await assert.rejects(()=>customerPaymentOutcome(ids.payment,'wrong-customer'),/not found/);
 await r.webhook(intent.providerReference);assert.equal(r.counts().refunds,1);
});

integration('successful webhook after ambiguous initialization timeout binds the precommitted reference',async t=>{
 const ids=await fixture(),r=runtime(ids,t,{initializationTimeout:true});
 await assert.rejects(r.init,/initialization timeout/);
 const attempt=(await query('select provider_reference from payment_attempts where payment_id=$1',[ids.payment]))[0];assert.ok(attempt.provider_reference);
 await r.webhook(attempt.provider_reference);assert.equal((await state(ids)).order_status,'paid');
 assert.equal(r.counts().creates,1);
});

integration('live checkout gets a deadline without supplying one; expiry releases its actual reservation and permits a new order',async()=>{
 const ids=await fixture();
 const client=await pool.connect();const q=async(s,p)=>(await client.query(s,p)).rows;
 try{
  await client.query('BEGIN');await q("select set_config('app.user_id',$1,true)",[ids.user]);
  await q("update products set status='active' where id=$1",[ids.product]);
  const checkout=async(key)=>(await q("select create_pending_order($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8) result",[ids.user,key,'b'.repeat(64),JSON.stringify([{productId:ids.product,variantId:ids.variant,quantity:1}]),JSON.stringify([{merchantId:ids.merchant,quoteId:ids.quote}]),'1 Test Street','mobile_money',null]))[0].result;
  const created=await checkout(ids.idem+'-live');const order=created.orders[0];
  const deadline=(await q('select payment_deadline>now() valid from orders where id=$1',[order.orderId]))[0];assert.equal(deadline.valid,true);
  assert.equal((await q('select stock from product_variants where id=$1',[ids.variant]))[0].stock,0);
  await q("update orders set payment_deadline=now()-interval '1 second' where id=$1",[order.orderId]);
  await q('select expire_payment_order($1)',[order.orderId]);
  assert.equal((await q('select stock from product_variants where id=$1',[ids.variant]))[0].stock,1);
  assert.equal((await checkout(ids.idem+'-live')).orders[0].status,'cancelled','same idempotency key cannot revive the order');
  assert.equal((await checkout(ids.idem+'-new')).orders[0].status,'payment_pending');
 }finally{await client.query('ROLLBACK');client.release()}
});

integration('enterprise checkout publishes its complete item list after inserting the order graph',async()=>{
 const ids=await fixture(),client=await pool.connect();const q=async(s,p)=>(await client.query(s,p)).rows;
 try{
  await q('BEGIN');await q("select set_config('app.user_id',$1,true)",[ids.user]);
  await q("update products set status='active' where id=$1",[ids.product]);
  await q("update merchants set catalog_source='enterprise_api',settlement_model='enterprise_direct' where id=$1",[ids.merchant]);
  await q("insert into enterprise_catalog_connections(id,merchant_id,endpoint_url,field_mapping,last_inventory_sync_at) values($1,$2,'https://erp.example.invalid/catalog','{}',now())",['conn_'+ids.merchant,ids.merchant]);
  const created=(await q("select create_pending_order($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8) result",[ids.user,ids.idem+'-enterprise','b'.repeat(64),JSON.stringify([{productId:ids.product,variantId:ids.variant,quantity:1}]),JSON.stringify([{merchantId:ids.merchant,quoteId:ids.quote}]),'1 Test Street','mobile_money',null]))[0].result;
  await q('SET CONSTRAINTS ALL IMMEDIATE');
  const event=(await q("select payload from enterprise_order_outbox where order_id=$1 and event_type='order.created'",[created.orders[0].orderId]))[0];
  assert.deepEqual(event.payload.items,[{productId:ids.product,quantity:1,unitPrice:100,productTotal:100}]);
 }finally{await q('ROLLBACK');client.release()}
});

integration('assisted checkout commits approved camelCase items and rejects changed items at commit',async()=>{
 for(const changed of [false,true]){
  const ids=await fixture(),client=await pool.connect();const q=async(s,p)=>(await client.query(s,p)).rows;
  const conversation='conv_'+ids.order,draft='draft_'+ids.order;
  await query('insert into support_conversations(id,customer_id) values($1,$2)',[conversation,ids.user]);
  await query('insert into support_order_drafts(id,conversation_id,customer_id,created_by,items) values($1,$2,$3,$3,$4)',[draft,conversation,ids.user,JSON.stringify([{productId:ids.product,variantId:ids.variant,quantity:changed?2:1}])]);
  try{
   await q('BEGIN');await q("select set_config('app.user_id',$1,true),set_config('app.assisted_draft_id',$2,true)",[ids.user,draft]);
   await q("update products set status='active' where id=$1",[ids.product]);
   const created=(await q("select create_pending_order($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8) result",[ids.user,ids.idem+'-assisted','b'.repeat(64),JSON.stringify([{productId:ids.product,variantId:ids.variant,quantity:1}]),JSON.stringify([{merchantId:ids.merchant,quoteId:ids.quote}]),'1 Test Street','mobile_money',null]))[0].result;
   if(changed){
    await assert.rejects(()=>q('COMMIT'),/modified after customer review/);
    assert.equal((await query('select id from orders where id=$1',[created.orders[0].orderId])).length,0);
    assert.equal((await query('select stock from product_variants where id=$1',[ids.variant]))[0].stock,1);
   }else await q('COMMIT');
   assert.equal((await query('select status from support_order_drafts where id=$1',[draft]))[0].status,changed?'pending':'completed');
  }finally{await q('ROLLBACK');client.release()}
 }
});

integration('refund completion and another order charge share a consistent counter lock order',async()=>{
 const refund=await fixture(),charge=await fixture();
 for(const ids of [refund,charge]){
  await query("select create_payment_attempt($1,$2,100,'GHS','{}')",[ids.payment,ids.provider]);
  await query('update payment_attempts set provider_reference=$1 where payment_id=$2',[ids.payment,ids.payment]);
 }
 await query("select apply_payment_webhook($1,$2,'charge.success',$3,'completed',100,'GHS',$4)",[refund.provider,refund.event,refund.payment,'c'.repeat(64)]);
 const request=(await query("select prepare_provider_refund_for_payment($1,$2,'cancel') result",[refund.payment,refund.user]))[0].result;
 await query("update provider_refund_requests set status='processing' where id=$1",[request.requestId]);
 const holder=await pool.connect(),completion=await pool.connect();let finishing;
 try{
  await holder.query('BEGIN');await holder.query("SET LOCAL statement_timeout='5s'");
  // Force completion to wait at reservation observation before the second charge
  // reaches payment observation. The former reverse ordering deadlocked here.
  await holder.query("select increment_observability_counter('reservation.status_changed',1)");
  const pid=(await completion.query('select pg_backend_pid() pid')).rows[0].pid;
  finishing=completion.query("select * from persist_provider_refund_result($1,'processed','fixture-refund','{}')",[request.requestId]);
  finishing.catch(()=>{});
  let waiting=false;
  for(let i=0;i<100;i++){
   const row=(await query('select wait_event_type from pg_stat_activity where pid=$1',[pid]))[0];
   if(row?.wait_event_type==='Lock'){waiting=true;break}
   await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.equal(waiting,true,'completion reaches the forced counter lock');
  await holder.query("select apply_payment_webhook($1,$2,'charge.success',$3,'completed',100,'GHS',$4)",[charge.provider,charge.event,charge.payment,'d'.repeat(64)]);
  await holder.query('COMMIT');await finishing;
  assert.equal((await state(refund)).payment_status,'refunded');assert.equal((await state(charge)).order_status,'paid');
 }finally{await holder.query('ROLLBACK');await finishing?.catch(()=>{});holder.release();completion.release()}
});
