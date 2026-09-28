import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { loadTypeScript } from './helpers/load-typescript.mjs';
const errors = loadTypeScript('src/lib/market/payment-errors.ts');
const { PaystackPaymentAdapter } = loadTypeScript('src/lib/market/adapters/providers/paystack.ts', {'@/lib/market/payment-errors':errors});
const adapter = new PaystackPaymentAdapter('fixture-secret');
const event = (id=123456) => JSON.stringify({event:'charge.success',data:{id,reference:'pat_fixture',amount:10000,currency:'GHS'}});

test('Paystack numeric/string IDs and reference fallback preserve signature verification', async () => {
  for (const id of [123456,'123456',undefined]) {
    const raw=event(id), signature=createHmac('sha512','fixture-secret').update(raw).digest('hex');
    assert.equal(await adapter.verifyWebhook(raw,signature),true);
    assert.equal(await adapter.verifyWebhook(raw+' ',signature),false);
    const parsed=await adapter.parseWebhook(raw);
    assert.equal(parsed.providerReference,'pat_fixture'); assert.equal(parsed.amount,100);
  }
});
test('Paystack rejects malformed identities, amounts, currency and JSON', async () => {
  for (const id of [0,-1,1.5,Number.MAX_SAFE_INTEGER+1,{},[],true,'']) await assert.rejects(()=>adapter.parseWebhook(event(id)));
  for (const amount of ['10000',true,{},0,-1,1.5]) await assert.rejects(()=>adapter.parseWebhook(JSON.stringify({event:'charge.success',data:{id:123456,reference:'p',amount,currency:'GHS'}})));
  await assert.rejects(()=>adapter.parseWebhook(event().replace('GHS','USD')));
  await assert.rejects(()=>adapter.parseWebhook('{'));
});

test('registry selects the bound Paystack driver and refuses implicit generic fallback', async () => {
  const registry=loadTypeScript('src/lib/market/adapters/registry.ts',{
    '@/lib/env.server':{isWorkspacePreview:()=>false},
    '@/lib/market/provider-policy.server':{normalizeProviderKey:x=>x},
    './payment':{JsonHttpPaymentAdapter:class {constructor(){throw new Error('wrong adapter')}},PreviewPaymentAdapter:class{}},
    './builtin-drivers':{builtinDrivers:{paystack:async()=>adapter}},
  });
  assert.equal(await registry.getPaymentAdapter('provider-alias','paystack'),adapter);
  await assert.rejects(()=>registry.getPaymentAdapter('provider-alias'),/driver/);
});
const { GeoapifyLocationProvider }=loadTypeScript('src/lib/market/adapters/location.server.ts',{
  '@/lib/db':{},'@/lib/env.server':{},'@/lib/security/rate-limit.server':{},
  '@/lib/security/body.server':loadTypeScript('src/lib/security/body.server.ts'),
});
const accra={results:[{lat:5.6037,lon:-0.187,formatted:'Oxford Street, Accra, Ghana',city:'Accra',country:'Ghana',country_code:'gh',rank:{confidence:0.95}}]};
test('Geoapify JSON Accra contract, Ghana filter and rank confidence', async t=>{
  t.mock.method(globalThis,'fetch',async url=>{
    assert.equal(url.searchParams.get('format'),'json');assert.equal(url.searchParams.get('filter'),'countrycode:gh');
    return Response.json(accra);
  });
  const result=await new GeoapifyLocationProvider('fixture').geocode('Oxford Street, Accra');
  assert.equal(result.latitude,5.6037);assert.equal(result.confidence,0.95);assert.equal(result.countryCode,'gh');
});
test('Geoapify invalid address, empty, malformed, non-Ghana, provider error and timeout fail safely', async t=>{
  const provider=new GeoapifyLocationProvider('fixture');
  let calls=0;
  const mock=t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json(accra)});
  await assert.rejects(()=>provider.geocode(' '),/Invalid/);assert.equal(calls,0);
  for (const body of [{results:[]},{features:[]},{results:[{...accra.results[0],lat:NaN}]},{results:[{...accra.results[0],country_code:'us'}]}]) {
    mock.mock.mockImplementation(async()=>Response.json(body));await assert.rejects(()=>provider.geocode('Accra'),/could not be found/);
  }
  mock.mock.mockImplementation(async()=>new Response('unavailable',{status:503}));await assert.rejects(()=>provider.geocode('Accra'),/HTTP 503/);
  mock.mock.mockImplementation(async()=>new Response('{'));await assert.rejects(()=>provider.geocode('Accra'),/invalid JSON/);
  mock.mock.mockImplementation(async(_url,options)=>{assert.ok(options.signal);throw new DOMException('timeout','TimeoutError')});await assert.rejects(()=>provider.geocode('Accra'),/timeout/);
});

test('admin password and trusted-device sessions have no TOTP assurance; only successful TOTP records it',async()=>{
  let calls=0;
  const module=loadTypeScript('src/lib/auth/mfa-assurance.server.ts',{'../db':{getSql:async()=>({query:async()=>{calls++}})}});
  for (const [path,result,trust] of [['/sign-in/email',{token:'password'},false],['/sign-in/email',{token:'trusted'},true],['/two-factor/verify-totp',{error:'bad code'},false],['/two-factor/verify-totp',{token:'trusted'},true]]) await module.recordTotpAssurance(path,result,trust);
  assert.equal(calls,0);
  await module.recordTotpAssurance('/two-factor/verify-totp',{token:'verified-session'},false);assert.equal(calls,1);
});

test('disabled optional push neither sends nor records false delivery',async()=>{
 const before=process.env.ELEMARKET_PUSH_PROVIDER;process.env.ELEMARKET_PUSH_PROVIDER='disabled';
 try{
  const push=loadTypeScript('src/lib/notifications/push/push.server.ts',{'@/lib/db':{getSql:()=>{throw new Error('unexpected DB')}},'@/lib/security/rate-limit.server':{},'./registry.server':{getPushProvider:()=>{throw new Error('unexpected provider')}}});
  assert.deepEqual(await push.sendPushToUser('synthetic',{title:'test',body:'test'}),[]);
  await assert.rejects(()=>push.registerPushDevice({userId:'synthetic',token:'synthetic',platform:'web'}),/disabled/);
 }finally{if(before===undefined)delete process.env.ELEMARKET_PUSH_PROVIDER;else process.env.ELEMARKET_PUSH_PROVIDER=before}
});
