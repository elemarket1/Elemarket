import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { betterAuth } from 'better-auth';
import { bearer, twoFactor } from 'better-auth/plugins';
import { createAuthMiddleware, APIError } from 'better-auth/api';
import { createHmac, randomBytes } from 'node:crypto';
import { loadTypeScript } from './helpers/load-typescript.mjs';
const enabled=process.env.RUN_DB_INTEGRATION==='1' && !!process.env.ELEMARKET_INTEGRATION_DATABASE_URL;
const pool=enabled ? new Pool({connectionString:process.env.ELEMARKET_INTEGRATION_DATABASE_URL}):null;
after(()=>pool?.end());
function totp(secret){
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits='';for(const c of secret.replace(/=/g,''))bits+=alphabet.indexOf(c.toUpperCase()).toString(2).padStart(5,'0');
 const bytes=Buffer.from(bits.match(/.{8}/g).map(x=>parseInt(x,2)));const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
 const digest=createHmac('sha1',bytes).update(counter).digest(),offset=digest.at(-1)&15;
 return String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');
}
test('real Better Auth password/trust bypass denied; valid TOTP binds current session and allows admin',{skip:!enabled?'Disposable PostgreSQL required':false},async()=>{
 const query=async(s,p)=>(await pool.query(s,p)).rows;
 const before={...process.env};process.env.DATABASE_URL=process.env.ELEMARKET_INTEGRATION_DATABASE_URL;process.env.ELEMARKET_ENV='development';process.env.BETTER_AUTH_URL='http://localhost:8080';process.env.BETTER_AUTH_IP_HEADER='x-fixture-ip';
 const mfa=loadTypeScript('src/lib/auth/mfa-assurance.server.ts',{'../db':{getSql:async()=>({query})}});
 let auth;
 try {
  auth=loadTypeScript('src/lib/auth/server.ts',{
    '../../../scripts/postgres-config.mjs':{postgresConfig:()=>({connectionString:process.env.ELEMARKET_INTEGRATION_DATABASE_URL})},
    'better-auth':{betterAuth},'better-auth/api':{createAuthMiddleware,APIError},'better-auth/plugins':{bearer,twoFactor},
    'better-auth/tanstack-start':{tanstackStartCookies:()=>({id:'test-cookie-transport'})},
    '@tanstack/react-start/server':{getCookie:()=>null},pg:{Pool:class {constructor(){return pool}}},
    '../db':{ensureDbReady:async()=>{},getPglite:async()=>{}},'./email-password':{emailAndPasswordEnabled:true},
    './email.server':{sendAuthEmail:async()=>{}},'./pglite-dialect':{},'../env.server':{getElemarketEnvironment:()=> 'development'},'./mfa-assurance.server':mfa,
  }).auth;
 } finally {process.env=before}
 // Each synthetic run owns a rate-limit identity; production limits stay enabled.
 const octets=randomBytes(2),fixtureIp=`198.18.${octets[0]}.${octets[1]}`;
 const jar=new Map();
 const call=async(path,body)=>{
  const response=await auth.handler(new Request('http://localhost:8080/api/auth'+path,{method:'POST',headers:{'x-fixture-ip':fixtureIp,origin:'http://localhost:8080','content-type':'application/json',cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; ')},body:JSON.stringify(body)}));
  for(const cookie of response.headers.getSetCookie()){const [pair]=cookie.split(';');const eq=pair.indexOf('=');jar.set(pair.slice(0,eq),pair.slice(eq+1))}
  return {status:response.status,body:await response.json()};
 };
 const email=`mfa_${randomBytes(8).toString('hex')}@integration.test`,password=randomBytes(24).toString('base64url');
 const signup=await call('/sign-up/email',{email,password,name:'Synthetic Admin'});assert.equal(signup.status,200);const user=signup.body.user.id;
 await query('update "user" set role=\'admin\',"emailVerified"=true where id=$1',[user]);
 await call('/sign-in/email',{email,password});
 const headers=()=>new Headers({cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; ')});
 const authorization=loadTypeScript('src/lib/auth/authorization.server.ts',{'./verify.server':{requireUserId:async()=>user},'@tanstack/react-start/server':{getRequest:()=>new Request('http://localhost:8080',{headers:headers()})},'./server':{auth},'../db':{getSql:async()=>({query})}});
 await assert.rejects(()=>authorization.requireAdminForUserId(user),/two-factor/);
 const enrollment=await call('/two-factor/enable',{password});assert.equal(enrollment.status,200);
 const secret=new URL(enrollment.body.totpURI).searchParams.get('secret');
 const bypass=await call('/two-factor/verify-totp',{code:totp(secret),trustDevice:true});assert.equal(bypass.status,403);
 await assert.rejects(()=>authorization.requireAdminForUserId(user),/two-factor/);
 const verified=await call('/two-factor/verify-totp',{code:totp(secret),trustDevice:false});assert.equal(verified.status,200,JSON.stringify(verified.body));
 await call('/sign-out',{});
 const login=await call('/sign-in/email',{email,password});assert.equal(login.body.twoFactorRedirect,true);
 await assert.rejects(()=>authorization.requireAdminForUserId(user));
 const loginTotp=await call('/two-factor/verify-totp',{code:totp(secret),trustDevice:false});assert.equal(loginTotp.status,200);
 assert.equal((await authorization.requireAdminForUserId(user)).role,'admin');
 // Reproduce a valid legacy trusted-device cookie issued before bypass was disabled.
 await call('/sign-out',{});
 const context=await auth.$context,identifier='trust-device-'+randomBytes(16).toString('hex');
 await context.internalAdapter.createVerificationValue({identifier,value:user,expiresAt:new Date(Date.now()+60000)});
 const inner=createHmac('sha256',context.secret).update(`${user}!${identifier}`).digest('base64url');
 const value=`${inner}!${identifier}`;
 const signed=encodeURIComponent(value+'.'+createHmac('sha256',context.secret).update(value).digest('base64'));
 jar.set(context.createAuthCookie('trust_device').name,signed);
 const trustedLogin=await call('/sign-in/email',{email,password});
 assert.equal(trustedLogin.status,200);assert.equal(trustedLogin.body.twoFactorRedirect,undefined);
 assert.ok((await auth.api.getSession({headers:headers()}))?.session,'legacy trust cookie did bypass the plugin challenge');
 await assert.rejects(()=>authorization.requireAdminForUserId(user),/verified TOTP/);
});
