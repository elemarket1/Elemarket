import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTypeScript} from './helpers/load-typescript.mjs';
const storage={getItemAsync:async()=>null,setItemAsync:async()=>{},deleteItemAsync:async()=>{}};
function load(){return loadTypeScript('mobile/src/auth.ts',{'expo-secure-store':storage});}
test('mobile production rejects cleartext loopback, non-HTTP schemes and URL credentials',()=>{
 const saved=process.env.EXPO_PUBLIC_API_BASE_URL,dev=globalThis.__DEV__;
 try{
  globalThis.__DEV__=false;
  for(const endpoint of ['http://localhost:8080','ftp://localhost','https://user:pass@example.com']){
   process.env.EXPO_PUBLIC_API_BASE_URL=endpoint;assert.throws(load);
  }
  process.env.EXPO_PUBLIC_API_BASE_URL='https://api.example.com';assert.doesNotThrow(load);
 }finally{if(saved===undefined)delete process.env.EXPO_PUBLIC_API_BASE_URL;else process.env.EXPO_PUBLIC_API_BASE_URL=saved;globalThis.__DEV__=dev;}
});
test('mobile login and authenticated requests cannot follow credential redirects',async t=>{
 const saved=process.env.EXPO_PUBLIC_API_BASE_URL;
 try{
  process.env.EXPO_PUBLIC_API_BASE_URL='https://api.example.com';
  const calls=[];t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push(options);return new Response('{}',{headers:{'set-auth-token':'s'.repeat(40)}});});
  const auth=load();await auth.signIn('synthetic@example.invalid','synthetic');
  await auth.apiFetch('/api/profile',{redirect:'follow'});
  assert.equal(calls.length,2);assert.ok(calls.every(x=>x.redirect==='error'&&x.signal));
 }finally{if(saved===undefined)delete process.env.EXPO_PUBLIC_API_BASE_URL;else process.env.EXPO_PUBLIC_API_BASE_URL=saved;}
});
