import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { loadTypeScript } from './helpers/load-typescript.mjs';

function transport({ addresses = [{address:'93.184.216.34',family:4}], status=200, body='ok', headers={}, onConnect=()=>{} }={}) {
  let lookups=0,requests=0;
  const module=loadTypeScript('src/lib/security/ssrf.server.ts',{
    'node:dns/promises': {lookup:async()=>{lookups++;return addresses;}},
    'node:https':{request:(url,options,receive)=>{
      requests++;onConnect(url,options);
      const req=new EventEmitter();req.destroy=()=>{};
      req.end=()=>queueMicrotask(()=>{const res=Readable.from([Buffer.from(body)]);res.statusCode=status;res.headers=headers;res.complete=true;receive(res);});
      return req;
    }},
  });
  return {...module,counts:()=>({lookups,requests})};
}
test('DNS pin uses only validated answers, preserves TLS origin, and rejects redirect hops',async()=>{
  const runtime=transport({onConnect:(url,options)=>{
    assert.equal(url.hostname,'provider.example.com');assert.equal(options.rejectUnauthorized,true);assert.equal(options.agent,false);
    options.lookup('provider.example.com',{all:false},(err,address,family)=>{assert.equal(err,null);assert.equal(address,'93.184.216.34');assert.equal(family,4);});
    options.lookup('provider.example.com',{all:true},(err,addresses)=>assert.deepEqual(addresses,[{address:'93.184.216.34',family:4}]));
    assert.equal(options.headers.host,'provider.example.com');
  }});
  assert.equal(await (await runtime.publicHttpsFetch('https://provider.example.com')).text(),'ok');
  assert.deepEqual(runtime.counts(),{lookups:1,requests:1});
  const redirected=transport({status:302,headers:{location:'http://169.254.169.254'}});
  await assert.rejects(()=>redirected.publicHttpsFetch('https://provider.example.com'),/redirects/);
  assert.equal(redirected.counts().requests,1);
});
test('mixed/private DNS, metadata, encoded IPs, invalid protocols/ports and transition addresses fail closed',async()=>{
  for(const addresses of [[{address:'127.0.0.1',family:4}],[{address:'93.184.216.34',family:4},{address:'10.0.0.1',family:4}]]) {
    const runtime=transport({addresses});await assert.rejects(()=>runtime.publicHttpsFetch('https://provider.example.com'));assert.equal(runtime.counts().requests,0);
  }
  const runtime=transport();
  for(const url of ['http://example.com','https://127.1','https://2130706433','https://[::ffff:127.0.0.1]','https://[2002:7f00:1::]','https://[fec0::1]','https://[64:ff9b:1::1]','https://169.254.169.254','https://example.com:8443','https://u:p@example.com']) await assert.rejects(()=>runtime.publicHttpsFetch(url),undefined,url);
  assert.equal(runtime.counts().requests,0);
});
test('outbound responses and DNS waits are bounded and abortable',async()=>{
  await assert.rejects(()=>transport({body:'12345'}).publicHttpsFetch('https://provider.example.com',{maxBytes:4}),/size limit/);
  await assert.rejects(()=>transport({headers:{'content-encoding':'gzip'}}).publicHttpsFetch('https://provider.example.com'),/encoding/);
  const module=loadTypeScript('src/lib/security/ssrf.server.ts',{'node:dns/promises':{lookup:()=>new Promise(()=>{})}});
  const controller=new AbortController();const pending=module.publicHttpsFetch('https://provider.example.com',{signal:controller.signal});controller.abort();await assert.rejects(()=>pending,/aborted/);
});
test('native Redis never uses a hosting flag to permit cleartext external connections',()=>{
 const {supportsNativeRedisUrl}=loadTypeScript('src/lib/security/native-redis-rate-limit.server.ts');
 assert.equal(supportsNativeRedisUrl('redis://external.example.com',{RENDER:'true'}),false);
 assert.equal(supportsNativeRedisUrl('redis://red-internal:6379',{}),true);
 assert.equal(supportsNativeRedisUrl('rediss://external.example.com',{}),true);
});
