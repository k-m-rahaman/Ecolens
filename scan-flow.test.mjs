import test from 'node:test';import assert from 'node:assert/strict';
import {runScan,resetOnlineCooldown,resolveOnlineEndpoint,FIREBASE_ONLINE_ENDPOINT,FIREBASE_PHOTO_CONSENT_KEY,cloudConsentAllowed,rememberFirebasePhotoConsent} from './scan-flow.js';
import {cameraConstraints,decodePhoto} from './media.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
const local={source:'offline',components:[{name:'paper',route:'recycle',confidence:.9}]},cloud={source:'online',components:[{name:'Paper',route:'recycle',confidence:.95}]};
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
test('online starts local and cloud together, publishes local preview and refines once',async()=>{resetOnlineCooldown();const a=deferred(),b=deferred(),calls=[],results=[];const pending=runScan({}, {mode:'online',consent:true,localAnalyze:()=>{calls.push('local');return a.promise},cloudAnalyze:()=>{calls.push('cloud');return b.promise},onResult:(value,meta)=>results.push([value.source,meta.pendingOnline])});await tick();assert.deepEqual(calls,['local','cloud']);a.resolve(local);await tick();assert.deepEqual(results,[['offline',true]]);b.resolve(cloud);assert.equal((await pending).source,'online');assert.deepEqual(results,[['offline',true],['online',false]]);});
test('a quick cloud result does not wait for local download',async()=>{const pendingLocal=deferred(),seen=[];const result=await runScan({}, {mode:'online',consent:true,localAnalyze:()=>pendingLocal.promise,cloudAnalyze:async()=>cloud,onResult:x=>seen.push(x.source)});pendingLocal.resolve(local);await tick();assert.equal(result.source,'online');assert.deepEqual(seen,['online']);});
test('use local now cancels cloud and finalizes existing local preview',async()=>{const choose=deferred(),slow=deferred();let cloudSignal;const pending=runScan({}, {mode:'online',consent:true,acceptLocal:choose.promise,localAnalyze:async()=>local,cloudAnalyze:(c,{signal})=>{cloudSignal=signal;return slow.promise}});await tick();choose.resolve();assert.equal((await pending).source,'offline');assert.equal(cloudSignal.aborted,true);slow.resolve(cloud);});
test('cloud timeout gives local fallback without waiting 35 seconds',async()=>{let timer;const start=performance.now();const result=await runScan({}, {mode:'online',consent:true,onlineTimeoutMs:15,localAnalyze:async()=>local,cloudAnalyze:()=>new Promise(()=>{}),onStatus:s=>{timer=s.error?.code}});assert.equal(result.source,'offline');assert.equal(timer,'ONLINE_TIMEOUT');assert.ok(performance.now()-start<1000);resetOnlineCooldown();});
test('unconfigured gateway cooldown avoids repeated slow cloud attempts',async()=>{resetOnlineCooldown();let calls=0;const options={mode:'online',consent:true,endpoint:'https://test.invalid/api/analyze',localAnalyze:async()=>local,cloudAnalyze:async()=>{calls++;throw Object.assign(new Error(),{code:'NOT_CONFIGURED'})}};await runScan({},options);await runScan({},options);assert.equal(calls,1);resetOnlineCooldown();await runScan({},options);assert.equal(calls,2);resetOnlineCooldown();});
test('offline/no consent never transmits images',async()=>{let calls=0;await runScan({}, {mode:'online',consent:false,localAnalyze:async()=>local,cloudAnalyze:async()=>{calls++;return cloud}});assert.equal(calls,0);});
test('inherited cloud permission cannot upload to the newly connected Firebase provider',async()=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'location');
 try{
  for(const hostname of ['ecolens-live.web.app','ecolens-live.firebaseapp.com']){
   Object.defineProperty(globalThis,'location',{configurable:true,value:{hostname}});
   let calls=0;const statuses=[];
   const consent=cloudConsentAllowed({endpoint:'',cloudConsent:true},{storage:{getItem:()=>null}});
   const result=await runScan({}, {mode:'online',consent,localAnalyze:async()=>local,cloudAnalyze:async()=>{calls++;return cloud},onStatus:value=>statuses.push(value.stage)});
   assert.equal(result.source,'offline');assert.equal(calls,0);assert.deepEqual(statuses,['analyzingLocal']);
  }
 }finally{if(previous)Object.defineProperty(globalThis,'location',previous);else delete globalThis.location;}
});

test('Firebase photo consent is explicit, revocable and separate from the progress backup',()=>{
 const records=new Map(),storage={getItem:key=>records.get(key),setItem:(key,value)=>records.set(key,value)};
 const settings={cloudConsent:true,endpoint:''};
 assert.equal(cloudConsentAllowed(settings,{storage,endpoint:FIREBASE_ONLINE_ENDPOINT}),false);
 assert.equal(rememberFirebasePhotoConsent(true,storage),true);
 assert.equal(storage.getItem(FIREBASE_PHOTO_CONSENT_KEY),'1');
 assert.equal(cloudConsentAllowed(settings,{storage,endpoint:FIREBASE_ONLINE_ENDPOINT}),true);
 assert.equal(cloudConsentAllowed({...settings,cloudConsent:false},{storage,endpoint:FIREBASE_ONLINE_ENDPOINT}),false);
 rememberFirebasePhotoConsent(false,storage);
 assert.equal(cloudConsentAllowed(settings,{storage,endpoint:FIREBASE_ONLINE_ENDPOINT}),false);
 assert.equal(cloudConsentAllowed(settings,{storage:{getItem(){throw new Error('blocked')}},endpoint:FIREBASE_ONLINE_ENDPOINT}),false);
 assert.equal(rememberFirebasePhotoConsent(true,{setItem(){throw new Error('blocked')}}),false);
 assert.equal(rememberFirebasePhotoConsent(true,null),false);
 assert.equal(cloudConsentAllowed(settings,{storage,endpoint:'https://custom.example/api/analyze'}),true);
});

test('a configured free Firebase scanner resolves without exposing an API gateway key',()=>{
 assert.equal(resolveOnlineEndpoint('',{hostname:'ecolens-live.web.app'},{firebaseReady:true}),FIREBASE_ONLINE_ENDPOINT);
 assert.equal(resolveOnlineEndpoint('',{hostname:'ecolens-live.web.app'},{firebaseReady:false}),'');
});
test('a custom cloud gateway and the local Node default remain available',()=>{
 assert.equal(resolveOnlineEndpoint('https://scanner.example/api/analyze',{hostname:'ecolens-live.web.app'}),'https://scanner.example/api/analyze');
 assert.equal(resolveOnlineEndpoint('',{hostname:'localhost'}),'./api/analyze');
});
test('cancelled scans publish no late result',async()=>{const a=deferred(),b=deferred(),controller=new AbortController(),seen=[];const pending=runScan({}, {mode:'online',consent:true,signal:controller.signal,localAnalyze:()=>a.promise,cloudAnalyze:()=>b.promise,onResult:x=>seen.push(x)});await tick();controller.abort();await assert.rejects(pending,{name:'AbortError'});a.resolve(local);b.resolve(cloud);await tick();assert.equal(seen.length,0);});
test('failed local engine still permits a valid cloud answer',async()=>{const result=await runScan({}, {mode:'online',consent:true,localAnalyze:async()=>{throw new Error('missing')},cloudAnalyze:async()=>cloud});assert.equal(result.source,'online');});
test('offline material preview remains provisional until the helper returns',async()=>{const helper=deferred(),seen=[];const preview={...local,uncertain:true};const pending=runScan({}, {localAnalyze:async(c,{onPartialResult})=>{onPartialResult(preview);return helper.promise},onResult:(value,meta)=>seen.push({value,meta})});await tick();assert.deepEqual(seen,[{value:preview,meta:{pendingOnline:false,pendingLocal:true}}]);helper.resolve(local);assert.equal(await pending,local);assert.deepEqual(seen[1],{value:local,meta:{pendingOnline:false,pendingLocal:false}});});
test('a completed cloud answer blocks later partial material callbacks',async()=>{let publish;const slow=deferred(),seen=[];await runScan({}, {mode:'online',consent:true,localAnalyze:async(c,{onPartialResult})=>{publish=onPartialResult;return slow.promise},cloudAnalyze:async()=>cloud,onResult:value=>seen.push(value)});publish({...local,uncertain:true});slow.resolve(local);await tick();assert.deepEqual(seen,[cloud]);});
test('camera constraints suit phones and laptops without requiring a rear camera',()=>{assert.equal(cameraConstraints().video.facingMode.ideal,'environment');assert.equal(cameraConstraints().audio,false);assert.equal(cameraConstraints({deviceId:'front'}).video.deviceId.exact,'front');assert.equal(cameraConstraints().video.width.ideal,960);});
test('mobile Image fallback decodes and revokes its object URL',async()=>{let revoked=false;class Image{set src(v){this.width=2400;this.height=1200;queueMicrotask(()=>this.onload())}}const scope={Image,URL:{createObjectURL:()=> 'blob:test',revokeObjectURL:()=>revoked=true},document:{createElement:()=>({getContext:()=>({drawImage(){}})})}};const canvas=await decodePhoto({}, {scope});assert.equal(canvas.width,960);assert.equal(canvas.height,480);assert.equal(revoked,true);});
test('bitmap path closes decoded large image and caps memory dimensions',async()=>{let closed=false;const scope={createImageBitmap:async()=>({width:1000,height:1000,close:()=>closed=true}),document:{createElement:()=>({getContext:()=>({drawImage(){}})})}};const canvas=await decodePhoto({}, {maxEdge:640,scope});assert.equal(canvas.width,640);assert.equal(closed,true);});
