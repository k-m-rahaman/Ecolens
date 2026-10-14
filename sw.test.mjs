import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const SCOPE='https://example.test/EcoLens/',SHELL_CACHE='ecolens-shell-naac-v10',MODEL_CACHE='ecolens-models-ort120-fp32-v1';
const url=path=>new URL(path,SCOPE).href;
function environment(){
 const listeners={},stores=new Map(),downloads=[],requests=[];let online=true,failedPath='',htmlPath='',claims=0,skips=0,putFailure='';
 const resolve=x=>typeof x==='string'?x:x.url;
 const store=name=>{
  if(!stores.has(name)){
   const map=new Map();stores.set(name,{map,match:async x=>map.get(resolve(x))?.clone(),put:async(x,r)=>{if(resolve(x).endsWith(putFailure)&&putFailure)throw new Error('Storage quota');map.set(resolve(x),r.clone());},delete:async x=>map.delete(resolve(x))});
  }return stores.get(name);
 };
 const self={registration:{scope:SCOPE},location:{origin:'https://example.test'},clients:{claim:async()=>claims++},skipWaiting:async()=>skips++,addEventListener:(type,fn)=>listeners[type]=fn};
 const cacheAPI={open:async n=>store(n),keys:async()=>[...stores.keys()],delete:async n=>stores.delete(n)};
 vm.runInNewContext(fs.readFileSync(new URL('./sw.js',import.meta.url),'utf8'),{self,caches:cacheAPI,URL,Response,AbortController,setTimeout,clearTimeout,fetch:async(req,options)=>{
  const address=resolve(req);downloads.push(address);requests.push({url:address,options});
  if(!online)throw new TypeError('Offline');if(failedPath&&address.endsWith(failedPath))return new Response('Missing asset',{status:404});
  return new Response(`fresh:${address}`,{headers:{'content-type':htmlPath&&address.endsWith(htmlPath)?'text/html':'text/plain'}});
 }});
 async function dispatch(type,event={}){let waited;listeners[type]({...event,waitUntil:p=>waited=p});await waited;}
 async function request(path,{mode='cors',method='GET'}={}){let result;listeners.fetch({request:{url:url(path),method,mode},respondWith:p=>result=p});return result?await result:undefined;}
 async function status(type='OFFLINE_STATUS'){let result;await dispatch('message',{data:{type},ports:[{postMessage:x=>result=x}]});return result;}
 return {listeners,stores,downloads,requests,store,dispatch,request,status,setOnline:x=>online=x,fail:x=>failedPath=x,html:x=>htmlPath=x,failPut:x=>putFailure=x,get claims(){return claims;},get skips(){return skips;}};
}
test('install precaches the complete immutable interface graph and no model weights',async()=>{
 const env=environment();await env.dispatch('install');assert.ok(env.downloads.includes(url('bootstrap.js')));assert.ok(env.downloads.includes(url('releases/naac-v10/app.js')));assert.ok(env.downloads.includes(url('releases/naac-v10/report.js')));assert.ok(env.downloads.includes(url('releases/naac-v10/styles.css')));
 assert.equal(env.downloads.some(x=>x.includes('/models/')||x.includes('/vendor/')),false);assert.ok(env.requests.every(x=>x.options.cache==='reload'));assert.equal((await env.status()).shellReady,true);assert.equal(env.skips,1);
});
test('online interface requests bypass an old cached module and stylesheet',async()=>{
 const env=environment();await env.dispatch('install');await env.store('ecolens-shell-v4-old').put(url('app.js'),new Response('old JS'));await env.store(SHELL_CACHE).put(url('releases/naac-v10/styles.css'),new Response('old CSS'));
 assert.equal(await(await env.request('app.js')).text(),`fresh:${url('app.js')}`);assert.equal(await(await env.request('releases/naac-v10/styles.css')).text(),`fresh:${url('releases/naac-v10/styles.css')}`);assert.equal(env.requests.at(-1).options.cache,'no-store');
});
test('a complete installed release reloads offline with matching translations and report module',async()=>{
 const env=environment();await env.dispatch('install');env.setOnline(false);
 assert.equal(await(await env.request('',{mode:'navigate'})).text(),`fresh:${url('index.html')}`);
 for(const path of ['bootstrap.js','releases/naac-v10/data.js','releases/naac-v10/report.js'])assert.equal(await(await env.request(path)).text(),`fresh:${url(path)}`);
});
test('a missing release file rejects installation and keeps the prior release and model cache',async()=>{
 const env=environment();await env.store('ecolens-shell-v4-old').put(url('index.html'),new Response('previous interface'));await env.store(MODEL_CACHE).put(url('models/custom-yolo/GarbageDetector.onnx'),new Response('saved weights'));env.fail('report.js');
 await assert.rejects(env.dispatch('install'),/Incomplete EcoLens release/);assert.equal(env.skips,0);await env.dispatch('activate');assert.equal(env.claims,0);assert.equal(env.stores.has('ecolens-shell-v4-old'),true);assert.equal(await(await env.store(MODEL_CACHE).match(url('models/custom-yolo/GarbageDetector.onnx'))).text(),'saved weights');assert.equal((await env.status()).shellReady,false);
});
test('an HTML error page cannot be installed as a JavaScript module',async()=>{
 const env=environment();env.html('data.js');await assert.rejects(env.dispatch('install'),/Invalid EcoLens release asset/);assert.equal((await env.status()).shellReady,false);
});
test('a quota error removes the partial new shell and does not remove an older complete shell',async()=>{
 const env=environment();await env.store('ecolens-shell-v4-old').put(url('index.html'),new Response('previous interface'));env.failPut('data.js');await assert.rejects(env.dispatch('install'),/Storage quota/);assert.equal(env.stores.has(SHELL_CACHE),false);assert.equal(env.stores.has('ecolens-shell-v4-old'),true);
});
test('offline navigation refuses a partial cache even if a completion marker survived',async()=>{
 const env=environment();await env.dispatch('install');await env.store(SHELL_CACHE).delete(url('releases/naac-v10/data.js'));env.setOnline(false);const response=await env.request('',{mode:'navigate'});assert.equal(response.status,503);assert.match(await response.text(),/finish the update/);assert.equal((await env.status()).shellReady,false);
});
test('normal model fetches cache on demand and repeated requests do not redownload',async()=>{
 const env=environment(),path='models/custom-yolo/GarbageDetector.onnx';await env.request(path);env.setOnline(false);assert.equal(await(await env.request(path)).text(),`fresh:${url(path)}`);assert.equal(env.downloads.filter(x=>x===url(path)).length,1);
});
test('offline preparation completes shell and model pack then skips all saved downloads',async()=>{
 const env=environment();assert.equal((await env.status()).modelsReady,false);const status=await env.status('CACHE_OFFLINE');assert.equal(status.ok,true);assert.equal(status.shellReady,true);const count=env.downloads.length;assert.equal((await env.status('CACHE_OFFLINE')).ok,true);assert.equal(env.downloads.length,count);
});
test('activation migrates existing offline weights and preserves unrelated caches',async()=>{
 const env=environment(),path='models/custom-yolo/GarbageDetector.onnx';await env.store('ecolens-pro-v2-old').put(url(path),new Response('old model'));await env.store('unrelated-app-cache').put(url('unrelated'),new Response('unrelated'));await env.dispatch('install');const count=env.downloads.length;await env.dispatch('activate');
 assert.equal(await(await env.store(MODEL_CACHE).match(url(path))).text(),'old model');assert.equal(env.downloads.length,count);assert.equal(env.stores.has('ecolens-pro-v2-old'),false);assert.equal(env.stores.has('unrelated-app-cache'),true);assert.equal(env.claims,1);
});
test('API posts and foreign resources are not intercepted',async()=>{
 const env=environment();assert.equal(await env.request('api/analyze'),undefined);assert.equal(await env.request('app.js',{method:'POST'}),undefined);let response;env.listeners.fetch({request:{url:'https://other.test/app.js',method:'GET',mode:'cors'},respondWith:x=>response=x});assert.equal(response,undefined);
});
