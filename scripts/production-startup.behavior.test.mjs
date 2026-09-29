import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { postgresConfig } from './postgres-config.mjs';
const config={RENDER:undefined,ELEMARKET_TRUST_PROXY:'1',ELEMARKET_PROXY_OVERWRITES_FORWARDED_FOR:'1',BETTER_AUTH_IP_HEADER:'x-forwarded-for',ELEMARKET_ENV:'staging',ELEMARKET_STORAGE_PROVIDER:'r2',ELEMARKET_LOCATION_PROVIDER:'geoapify',ELEMARKET_EMAIL_PROVIDER:'resend',ELEMARKET_OTP_PROVIDER:'arkesel',DATABASE_URL:'postgresql://synthetic:synthetic@database.invalid/elemarket',PG_SSL_MODE:'verify-full',REDIS_URL:'https://redis.example.invalid',REDIS_HTTP_TOKEN:'fixture',BETTER_AUTH_SECRET:'a'.repeat(40),BETTER_AUTH_URL:'https://market.example.invalid',CRON_SECRET:'b'.repeat(40),ELEMARKET_MERCHANT_DATA_ENCRYPTION_KEY:'c'.repeat(64),ELEMARKET_ENTERPRISE_SYNC_SECRET:'d'.repeat(40),ELEMARKET_PUBLIC_URL:'https://market.example.invalid',GEOAPIFY_API_KEY:'fixture',ARKESEL_API_KEY:'fixture',ARKESEL_OTP_SENDER_ID:'ELEMARKET',CLOUDFLARE_R2_ACCOUNT_ID:'e'.repeat(32),CLOUDFLARE_R2_ACCESS_KEY_ID:'fixture',CLOUDFLARE_R2_SECRET_ACCESS_KEY:'fixture',CLOUDFLARE_R2_BUCKET:'fixture',ELEMARKET_PAYMENT_PROVIDERS:'paystack',ELEMARKET_PAYMENT_PAYSTACK_DRIVER:'paystack',ELEMARKET_PAYMENT_PAYSTACK_SECRET:'fixture',ELEMARKET_SETTLEMENT_MODE:'provider_direct_uncontrolled',RESEND_API_KEY:'fixture',RESEND_FROM_EMAIL:'fixture@example.invalid',RESEND_WEBHOOK_SECRET:'fixture',ELEMARKET_PUSH_PROVIDER:'disabled'};
const run=env=>spawnSync(process.execPath,['scripts/validate-startup-env.mjs'],{env:{PATH:process.env.PATH,...env},encoding:'utf8'});
test('staging starts without delivery configuration; enabled providers still require their own credentials',()=>{
 assert.equal(run(config).status,0);
 assert.equal(run({...config,ELEMARKET_DELIVERY_PROVIDER:undefined}).status,0);

 const postgresLimiter={...config};delete postgresLimiter.REDIS_URL;delete postgresLimiter.REDIS_HTTP_TOKEN;assert.equal(run(postgresLimiter).status,0);
 const renderConfig={...config,DATABASE_URL:'postgresql://synthetic:synthetic@dpg-render-internal:5432/elemarket',RENDER:'true',PG_SSL_MODE:'require',REDIS_URL:'redis://red-test:6379'};
 delete renderConfig.REDIS_HTTP_TOKEN;
 assert.equal(run(renderConfig).status,0);
 assert.notEqual(run({...renderConfig,PG_SSL_MODE:'disable'}).status,0);
 assert.notEqual(run({...renderConfig,PG_SSL_MODE:'verify-ca'}).status,0);
 const renderDockerConfig={...config,RENDER:undefined,PG_SSL_MODE:'require',DATABASE_URL:'postgresql://synthetic:synthetic@dpg-render-internal:5432/elemarket',REDIS_URL:'redis://red-render-internal:6379'};
 delete renderDockerConfig.REDIS_HTTP_TOKEN;
 assert.equal(run(renderDockerConfig).status,0);
 for(const key of Object.keys(config).filter(k=>!['RENDER','ELEMARKET_ENV','ELEMARKET_PUSH_PROVIDER','REDIS_URL','ELEMARKET_SETTLEMENT_MODE','ELEMARKET_PAYMENT_PROVIDERS','ELEMARKET_PAYMENT_PAYSTACK_DRIVER','ELEMARKET_PAYMENT_PAYSTACK_SECRET'].includes(k))){const env={...config};delete env[key];assert.notEqual(run(env).status,0,key)}
 const paymentDisabled={...config};delete paymentDisabled.ELEMARKET_PAYMENT_PROVIDERS;delete paymentDisabled.ELEMARKET_PAYMENT_PAYSTACK_DRIVER;delete paymentDisabled.ELEMARKET_PAYMENT_PAYSTACK_SECRET;assert.equal(run(paymentDisabled).status,0);

 for(const change of [{REDIS_URL:'redis://external.invalid:6379'},{PG_SSL_MODE:'disable'},{ELEMARKET_PAYMENT_PAYSTACK_DRIVER:'http'}])assert.notEqual(run({...config,...change}).status,0);
});
test('PostgreSQL pools are bounded and production cannot bypass certificate verification using URL flags',()=>{
 const c=postgresConfig('postgresql://localhost/db?sslmode=no-verify',config);assert.equal(c.ssl.rejectUnauthorized,true);assert.equal(c.max,10);assert.equal(c.connectionTimeoutMillis,5000);assert.ok(!c.connectionString.includes('sslmode'));
 const render=postgresConfig('postgresql://dpg-render-internal/db?sslmode=disable',{...config,RENDER:'true',PG_SSL_MODE:'require'});assert.equal(render.ssl.rejectUnauthorized,false);assert.equal(render.max,10);assert.ok(!render.connectionString.includes('sslmode'));
 assert.throws(()=>postgresConfig(config.DATABASE_URL,{...config,PG_SSL_MODE:'require'}));
 assert.throws(()=>postgresConfig(config.DATABASE_URL,{...config,RENDER:'true',PG_SSL_MODE:'require'}));
 assert.notEqual(run({...config,RENDER:'true',REDIS_URL:'redis://external.invalid:6379'}).status,0);
 assert.notEqual(run({...config,ELEMARKET_ENV:'PRODUCTION'}).status,0);
 assert.doesNotThrow(()=>postgresConfig('postgresql://user:pass@dpg-render-internal:5432/db',{...config,RENDER:undefined,PG_SSL_MODE:'require'}));
 assert.throws(()=>postgresConfig(config.DATABASE_URL,{...config,RENDER:'true',PG_SSL_MODE:'disable'}));
 for(const PG_POOL_MAX of ['0','51','NaN'])assert.throws(()=>postgresConfig(config.DATABASE_URL,{...config,PG_POOL_MAX}));
 assert.throws(()=>postgresConfig(config.DATABASE_URL,{...config,PG_SSL_MODE:'disable'}));
});
test('scheduled ECS job signs method, path, timestamp, nonce and body for the existing HMAC endpoint',()=>{
 const hook=`import assert from 'node:assert/strict';import {createHash,createHmac} from 'node:crypto';
 globalThis.fetch=async(url,options)=>{
  assert.equal(url.pathname,'/api/internal/expire-payment-orders');assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.ok(options.signal);
  const h=options.headers;assert.match(h['x-elemarket-sync-nonce'],/^[A-Za-z0-9._~-]{16,128}$/);
  const message=h['x-elemarket-sync-timestamp']+'.'+h['x-elemarket-sync-nonce']+'.GET.'+url.pathname+'.'+createHash('sha256').update('').digest('hex');
  assert.equal(h['x-elemarket-sync-signature'],createHmac('sha256',process.env.CRON_SECRET).update(message).digest('hex'));
  return Response.json({ok:true});
 };`;
 const child=spawnSync(process.execPath,['--import','data:text/javascript;base64,'+Buffer.from(hook).toString('base64'),'scripts/run-scheduled-job.mjs','expire-payments'],{env:{PATH:process.env.PATH,ELEMARKET_PUBLIC_URL:'https://synthetic.invalid',CRON_SECRET:'s'.repeat(40)},encoding:'utf8'});
 assert.equal(child.status,0,child.stderr);assert.match(child.stdout,/scheduled_job.completed/);
});

