import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { createPaymentFixture } from './helpers/payment-fixture.mjs';
import { loadTypeScript } from './helpers/load-typescript.mjs';
const enabled = process.env.RUN_DB_INTEGRATION === '1' && !!process.env.ELEMARKET_INTEGRATION_DATABASE_URL;
const pool = enabled ? new Pool({ connectionString: process.env.ELEMARKET_INTEGRATION_DATABASE_URL }) : null;
after(() => pool?.end());
const query = async (sql, params = []) => (await pool.query(sql, params)).rows;
const integration = (name, fn) => test(name, { skip: enabled ? false : 'Disposable PostgreSQL required' }, fn);

integration('active SQL financial functions contain no vendor-specific branches', async () => {
  const functions = await query(`select proname, pg_get_functiondef(p.oid) as body from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'`);
  for (const fn of functions) assert.doesNotMatch(fn.body, /(?:if|when|where)[^;\n]*=\s*'(?:paystack|hubtel|geoapify|resend|arkesel|fcm|fylings)'/i, fn.proname);
  const webhook = functions.find(f => f.proname === 'apply_payment_webhook');
  assert.match(webhook.body, /payment_driver_capabilities/);
  assert.match(webhook.body, /for update/);
});
integration('location cache accepts configured provider identities and preserves coordinate constraints', async () => {
  const id = `provider-test-${crypto.randomUUID()}`;
  await query(`insert into geocode_cache(cache_key,provider,latitude,longitude,formatted_address,expires_at) values($1,'another-location',5.6,-0.18,'Synthetic location',now()+interval '1 day')`, [id]);
  assert.equal((await query('select provider from geocode_cache where cache_key=$1',[id]))[0].provider,'another-location');
  await assert.rejects(() => query('update geocode_cache set latitude=91 where cache_key=$1',[id]));
  await query('delete from geocode_cache where cache_key=$1',[id]);
});
integration('email OTP concurrency uniqueness applies across provider changes', async () => {
  const destination = `${crypto.randomUUID()}@example.invalid`;
  const insert = provider => query(`insert into otp_challenges(id,destination,purpose,provider,status,expires_at,cooldown_until,code_hash) values($1,$2,'login',$3,'pending',now()+interval '5 minutes',now(),$4)`,[crypto.randomUUID(),destination,provider,'a'.repeat(64)]);
  const results = await Promise.allSettled([insert('mail-one'),insert('mail-two')]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  await query('delete from otp_challenges where destination=$1',[destination]);
});
integration('push registration races cannot transfer token ownership; sends are bound to provider', async () => {
  const users = [`push-${crypto.randomUUID()}`, `push-${crypto.randomUUID()}`];
  for (const user of users) await query('insert into "user"(id,name,email,"emailVerified") values($1,$1,$2,true)',[user,`${user}@example.invalid`]);
  const sent = [];
  const runtime = loadTypeScript('src/lib/notifications/push/push.server.ts', {
    '@/lib/providers/catalog.mjs': { selectedProvider: () => ({key:'transport-one'}) },
    '@/lib/db': {getSql:async()=>({query})}, '@/lib/security/rate-limit.server':{enforceRateLimit:async()=>{}},
    './registry.server': { getPushProvider: () => ({key:'transport-one', sendToToken:async token=>{sent.push(token);return {accepted:true}}}) },
  });
  const token = 'synthetic-token-'+crypto.randomUUID();
  const results = await Promise.allSettled(users.map(userId=>runtime.registerPushDevice({userId,token,platform:'web'})));
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  const owner = (await query('select user_id from push_devices where token=$1',[token]))[0].user_id;
  await query("insert into push_devices(id,user_id,token,token_hash,platform,provider_key) values($1,$2,'other-provider-token',$1,'web','transport-two')",[crypto.randomUUID(),owner]);
  await runtime.sendPushToUser(owner,{title:'Synthetic',body:'Synthetic'});
  assert.deepEqual(sent,[token]);
  for (const user of users) await query('delete from "user" where id=$1',[user]);
});
integration('withdrawal eligibility requires 24 hours, blocks disputes and cannot enable custody', async () => {
  const ids = await createPaymentFixture(query);
  const eligible = async () => (await query('select merchant_order_withdrawal_eligibility($1,$2) result',[ids.merchant,ids.order]))[0].result;
  assert.equal((await eligible()).eligible,false);
  const attempt = (await query("select create_payment_attempt($1,$2,100,'GHS','{}') result",[ids.payment,ids.provider]))[0].result;
  await query('update payment_attempts set provider_reference=$1 where id=$2',[ids.payment,attempt.attemptId]);
  await query("select apply_payment_webhook($1,$2,'payment.completed',$3,'completed',100,'GHS',$4)",[ids.provider,ids.event,ids.payment,'a'.repeat(64)]);
  await query('insert into merchant_accounts(merchant_id,user_id) values($1,$2)',[ids.merchant,ids.user]);
  for (const status of ['confirmed','fulfilling','shipped']) await query('select merchant_advance_order($1,$2,$3,$4)',[ids.merchant,ids.order,status,ids.user]);
  await query('select customer_confirm_order_received($1,$2)',[ids.order,ids.user]);
  await query("update merchant_order_status_history set created_at=now()-interval '23 hours' where order_id=$1 and to_status='delivered'",[ids.order]);
  assert.equal((await eligible()).eligible,false);
  await query("update merchant_order_status_history set created_at=now()-interval '25 hours' where order_id=$1",[ids.order]);
  assert.equal((await eligible()).eligible,true);
  await assert.rejects(()=>query('select merchant_order_withdrawal_eligibility($1,$2)',['other-merchant',ids.order]),/order not found/);
  const result = await eligible(); assert.equal(result.eligibilityScope,"elemarket_policy_only");
  await query('select open_customer_order_dispute($1,$2,$3)',[ids.order,ids.user,'Synthetic customer dispute']);
  const repeated = await Promise.all(Array.from({length:8},eligible));
  assert.ok(repeated.every(x=>x.eligible===false));
  await assert.rejects(()=>query('select create_merchant_fund_release_request($1,100)',[ids.merchant]),/disabled|does not exist/);
  assert.equal((await query('select count(*)::int n from escrows where order_id=$1',[ids.order]))[0].n,0);
  const disabled = await query(`select proname,pg_get_functiondef(p.oid) body from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('create_merchant_fund_release_request','review_merchant_fund_release_request')`);
  for (const fn of disabled) assert.match(fn.body,/disabled/);
});

integration('first payment pins its driver while concurrent reconfiguration waits and fails after commit', async () => {
  const insert = await pool.connect(), edit = await pool.connect();
  let transaction = false;
  try {
    const ids = await createPaymentFixture(async (sql, params) => {
      if (/insert into payments\s*\(/.test(sql)) {
        await insert.query('begin'); transaction = true;
        return (await insert.query(sql, params)).rows;
      }
      return query(sql, params);
    });
    await edit.query('begin');
    await edit.query("set local lock_timeout='100ms'");
    await assert.rejects(()=>edit.query("update payment_providers set driver_key='other' where provider_key=$1",[ids.provider]),/lock timeout/);
    await edit.query('rollback');
    await insert.query('commit'); transaction = false;
    await assert.rejects(()=>edit.query("update payment_providers set driver_key='other' where provider_key=$1",[ids.provider]),/cannot change driver/);
    assert.equal((await query('select driver_key from payments where id=$1',[ids.payment]))[0].driver_key,'http');
  } finally {
    if(transaction) await insert.query('rollback');
    await edit.query('rollback');insert.release();edit.release();
  }
});
integration('definer functions pin trusted schemas ahead of pg_temp', async () => {
  const functions = await query("select proname,proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef");
  assert.ok(functions.length>0);
  for(const fn of functions) assert.ok(fn.proconfig.includes('search_path=pg_catalog, public, pg_temp'),fn.proname);
});
integration('telemetry never holds a shared counter lock across financial transactions and preserves all increments',async()=>{
 const first=await pool.connect(),second=await pool.connect();
 const key=`counter-race-${crypto.randomUUID()}`;
 try{
  await first.query('begin');await second.query('begin');
  await second.query("set local lock_timeout='100ms'");
  await first.query('select increment_observability_counter($1,1)',[key]);
  await second.query('select increment_observability_counter($1,2)',[key]);
  await first.query('select increment_observability_counter($1,3)',[key]);
  await second.query('commit');await first.query('commit');
  assert.equal(Number((await query('select sum(value) total from observability_counters where metric_key=$1',[key]))[0].total),6);
 }finally{await first.query('rollback');await second.query('rollback');await query('delete from observability_counters where metric_key=$1',[key]);first.release();second.release();}
});
