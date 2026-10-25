const RELEASE='naac-v19';
const SHELL_CACHE=`ecolens-shell-${RELEASE}`;
const MODEL_CACHE='ecolens-models-ort120-fp32-v1';
const NETWORK_WAIT_MS=2500;
// Install the immutable release graph together; model weights keep their stable cache.
const RELEASE_FILES=['app.js','core.js','data.js','inference.js','scan-flow.js','media.js','report.js','public-sync.js','public-config.js','firebase-sync.js','firebase-ai.js','firebase-ai-config.js','styles.css'];
const SHELL=['./index.html','./bootstrap.js',...RELEASE_FILES.map(name=>`./releases/${RELEASE}/${name}`),'./assets/ecolens-mark.svg','./manifest.webmanifest','./assets/icon.svg','./assets/images/Mascot.webp','./vendor/firebase-ai-sdk.js','./vendor/firebase-app-13.0.0.js','./vendor/firebase-ai-13.0.0.js','./vendor/firebase-app-check-13.0.0.js'];
const MODELS=['./vendor/ort.min.js','./vendor/ort-wasm-simd-threaded.mjs','./vendor/ort-wasm-simd-threaded.wasm','./vendor/tf.min.js','./vendor/coco-ssd.min.js','./models/custom-yolo/GarbageDetector.onnx','./models/coco/model.json',...Array.from({length:5},(_,i)=>`./models/coco/group1-shard${i+1}of5`)];
const absolute=path=>new URL(path,self.registration.scope).href;
const markerUrl=absolute(`./.ecolens-shell-${RELEASE}-complete`);
const shellUrls=new Set(SHELL.map(absolute)),modelUrls=new Set(MODELS.map(absolute));
const legacyShellUrls=new Set(['./',...RELEASE_FILES.map(name=>`./${name}`)].map(absolute));
async function shellReady(){
 const cache=await caches.open(SHELL_CACHE);
 if(!await cache.match(markerUrl))return false;
 return (await Promise.all(SHELL.map(path=>cache.match(absolute(path))))).every(Boolean);
}
async function modelStatus(){const cache=await caches.open(MODEL_CACHE);const items=await Promise.all(MODELS.map(path=>cache.match(absolute(path))));return {modelsReady:items.every(Boolean),cached:items.filter(Boolean).length,total:MODELS.length,shellReady:await shellReady()};}
async function installShell(){
 // Fetch every file before publishing any changes. A failed update keeps the
 // previously usable offline release and cannot publish a half-new interface.
 const responses=await Promise.all(SHELL.map(async path=>{
  const url=absolute(path),response=await fetch(url,{cache:'reload'});
  if(!response.ok)throw new Error(`Incomplete EcoLens release: ${path}`);
  const mime=response.headers.get('content-type')||'';
  if((path.endsWith('.js')||path.endsWith('.css'))&&mime.includes('text/html'))throw new Error(`Invalid EcoLens release asset: ${path}`);
  return [url,response];
 }));
 const cache=await caches.open(SHELL_CACHE);
 await cache.delete(markerUrl);
 try{
  for(const [url,response] of responses)await cache.put(url,response);
  await cache.put(markerUrl,new Response(RELEASE,{headers:{'content-type':'text/plain'}}));
 }catch(error){await caches.delete(SHELL_CACHE);throw error;}
}
async function prepareOffline(){
 if(!await shellReady())await installShell();
 const models=await caches.open(MODEL_CACHE);
 for(let index=0;index<MODELS.length;index+=2){
  await Promise.all(MODELS.slice(index,index+2).map(async path=>{const url=absolute(path);if(!await models.match(url)){const response=await fetch(url,{cache:'reload'});if(!response.ok)throw new Error('Offline model download failed');await models.put(url,response);}}));
 }
 return modelStatus();
}
async function fresh(request){
 const controller=new AbortController();let timer;
 try{return await Promise.race([
  fetch(request,{cache:'no-store',signal:controller.signal}),
  new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Network unavailable'));},NETWORK_WAIT_MS);})
 ]);}finally{clearTimeout(timer);}
}
async function shellResponse(request,canonical,navigate){
 try{const response=await fresh(request);if(response.ok)return response;}catch{}
 if(await shellReady()){
  const cache=await caches.open(SHELL_CACHE),saved=await cache.match(navigate?absolute('./index.html'):canonical);
  if(saved)return saved;
 }
 return new Response('EcoLens is unavailable offline. Connect once to finish the update.',{status:503,headers:{'content-type':'text/plain; charset=utf-8'}});
}
self.addEventListener('install',event=>event.waitUntil(installShell().then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 if(!await shellReady())return;
 // Updating the interface reuses weights and never clears saved profiles.
 const keys=await caches.keys(),models=await caches.open(MODEL_CACHE);
 for(const key of keys.filter(x=>x.startsWith('ecolens-pro-'))){const old=await caches.open(key);for(const path of MODELS){const url=absolute(path);if(!await models.match(url)){const response=await old.match(url);if(response)await models.put(url,response);}}}
 await Promise.all(keys.filter(key=>(key.startsWith('ecolens-pro-')||key.startsWith('ecolens-shell-'))&&key!==SHELL_CACHE&&key!==MODEL_CACHE).map(key=>caches.delete(key)));
 await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.includes('/api/'))return;
 url.search='';url.hash='';const canonical=url.href;
 if(modelUrls.has(canonical)){
  event.respondWith((async()=>{const cache=await caches.open(MODEL_CACHE),saved=await cache.match(canonical);if(saved)return saved;const response=await fetch(event.request);if(response.ok)await cache.put(canonical,response.clone());return response;})());return;
 }
 const navigate=event.request.mode==='navigate';
 if(navigate||shellUrls.has(canonical)||legacyShellUrls.has(canonical))event.respondWith(shellResponse(event.request,canonical,navigate));
});
self.addEventListener('message',event=>{
 if(event.data?.type==='OFFLINE_STATUS'){event.waitUntil(modelStatus().then(status=>event.ports[0]?.postMessage(status)));return;}
 if(event.data?.type!=='CACHE_OFFLINE')return;
 event.waitUntil(prepareOffline().then(status=>event.ports[0]?.postMessage({ok:status.modelsReady&&status.shellReady,...status})).catch(()=>event.ports[0]?.postMessage({ok:false})));
});
