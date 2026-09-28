import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTypeScript } from './helpers/load-typescript.mjs';

test('configured search adapter bounds results and quotes provider filter literals',async()=>{
 let target;
 const {TypesenseSearchProvider}=loadTypeScript('src/lib/market/adapters/providers/typesense.server.ts',{'@/lib/security/ssrf.server':{publicHttpsFetch:async url=>{target=url;return Response.json({found:0,hits:[]});}}});
 const provider=new TypesenseSearchProvider('https://search.example.com','synthetic');
 const response=await provider.search({limit:20,sort:'price_asc',category:'Food || stock:>0',inStock:true},'rice',2);
 assert.deepEqual(response.hits,[]);assert.equal(target.searchParams.get('page'),'2');
 assert.equal(target.searchParams.get('filter_by'),'category:=`Food || stock:>0` && stock:>0');
 assert.equal(target.searchParams.get('sort_by'),'price:asc,id:asc');
});
test('search registry never implicitly activates an optional vendor and unknown selections fail',()=>{
 const original={...process.env};
 try {
  delete process.env.ELEMARKET_SEARCH_PROVIDER;process.env.TYPESENSE_HOST='https://search.example.com';process.env.TYPESENSE_SEARCH_KEY='synthetic';
  const {getSearchProvider}=loadTypeScript('src/lib/market/adapters/search-registry.server.ts',{'./providers/typesense.server':{TypesenseSearchProvider:class{}}});
  assert.equal(getSearchProvider(),null);process.env.ELEMARKET_SEARCH_PROVIDER='uninstalled';assert.throws(()=>getSearchProvider(),/unavailable/);
  process.env.ELEMARKET_SEARCH_PROVIDER='typesense';delete process.env.TYPESENSE_SEARCH_KEY;assert.throws(()=>getSearchProvider(),/missing/);
 } finally {process.env=original;}
});
