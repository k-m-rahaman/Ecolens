import {analyzeOffline,analyzeOnline} from './inference.js';

const cooldowns=new Map();
const cooldownCodes=new Set(['NOT_CONFIGURED','FREE_TIER_REQUIRED','QUOTA_STORAGE_REQUIRED','RATE_LIMIT','DAILY_LIMIT','PROVIDER_QUOTA','PROVIDER_TIMEOUT','ONLINE_TIMEOUT','ONLINE_UNAVAILABLE','PROVIDER_UNAVAILABLE']);
export function resetOnlineCooldown(endpoint){if(endpoint)cooldowns.delete(endpoint);else cooldowns.clear();}
// Firebase's free static hosting has no same-origin Node vision gateway.
// A custom HTTPS service remains optional; local Node launches keep their default.
export function resolveOnlineEndpoint(endpoint='', page=globalThis.location){
 const configured=typeof endpoint==='string'?endpoint.trim():'';
 if(configured)return configured;
 if(/^[a-z0-9-]+\.(?:web\.app|firebaseapp\.com)$/i.test(page?.hostname||''))return '';
 return './api/analyze';
}
function abortError(){return new DOMException('Scan cancelled.','AbortError');}
function childController(signal){const controller=new AbortController();const abort=()=>controller.abort();if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});return {controller,clean:()=>signal?.removeEventListener('abort',abort)};}
function bounded(task,{controller,signal,timeoutMs,code}){
 let timer,listener;
 const expiry=new Promise((_,reject)=>{timer=setTimeout(()=>{const error=new Error(code);error.code=code;reject(error);controller.abort();},timeoutMs);listener=()=>reject(abortError());if(controller.signal.aborted)listener();else controller.signal.addEventListener('abort',listener,{once:true});});
 return Promise.race([task,expiry]).finally(()=>{clearTimeout(timer);controller.signal.removeEventListener('abort',listener);});
}

/** A local preview and optional cloud refinement share one cancellable scan. */
export async function runScan(canvas,{
 mode='offline',consent=false,online=true,endpoint='',language='en',scene='single',signal,
 onStatus=()=>{},onProgress=()=>{},onResult=()=>{},acceptLocal,
 localAnalyze=analyzeOffline,cloudAnalyze=analyzeOnline,localTimeoutMs=25000,onlineTimeoutMs=12000,now=()=>Date.now()
}={}){
 if(signal?.aborted)throw abortError();
 endpoint=resolveOnlineEndpoint(endpoint);
 const localChild=childController(signal),cloudChild=childController(signal);
 let finalized=false,localResult=null;
 const cloudEnabled=mode==='online'&&consent&&online&&Boolean(endpoint)&&!(cooldowns.get(endpoint)>now());
 const result=(value,pendingOnline,pendingLocal=false)=>{if(!finalized&&!signal?.aborted)onResult(value,{pendingOnline,pendingLocal});};
 onStatus({stage:cloudEnabled?'requestingCloud':'analyzingLocal'});
 const localTask=bounded(Promise.resolve().then(()=>localAnalyze(canvas,{signal:localChild.controller.signal,scene,onProgress,queue:true,onPartialResult:value=>result(value,cloudEnabled,true)})),{controller:localChild.controller,signal,timeoutMs:localTimeoutMs,code:'LOCAL_TIMEOUT'})
  .then(value=>{localResult=value;if(cloudEnabled)result(value,true);return {kind:'local',value};},error=>({kind:'localError',error}));
 let cloudTask;
 if(cloudEnabled){
  cloudTask=bounded(Promise.resolve().then(()=>cloudAnalyze(canvas,{endpoint,language,scene,signal:cloudChild.controller.signal,timeoutMs:onlineTimeoutMs})),{controller:cloudChild.controller,signal,timeoutMs:onlineTimeoutMs+100,code:'ONLINE_TIMEOUT'})
   .then(value=>({kind:'cloud',value}),error=>{if(!signal?.aborted&&!cloudChild.controller.signal.aborted&&cooldownCodes.has(error.code))cooldowns.set(endpoint,now()+60000);if(!signal?.aborted&&['ONLINE_TIMEOUT','PROVIDER_TIMEOUT'].includes(error.code))cooldowns.set(endpoint,now()+30000);return {kind:'cloudError',error};});
 }
 const localChoice=acceptLocal?Promise.resolve(acceptLocal).then(()=>({kind:'acceptLocal'})):new Promise(()=>{});
 try{
  if(!cloudEnabled){const local=await localTask;if(signal?.aborted)throw abortError();if(local.kind==='localError')throw local.error;finalized=true;onResult(local.value,{pendingOnline:false,pendingLocal:false});return local.value;}
  let first=await Promise.race([localTask,cloudTask,localChoice]);
  if(first.kind==='local'){
   onStatus({stage:'localResultReady',pendingOnline:true});
   first=await Promise.race([cloudTask,localChoice]);
  }else if(first.kind==='localError'){
   first=await Promise.race([cloudTask,localChoice]);
  }
  if(signal?.aborted)throw abortError();
  if(first.kind==='cloud'){
   finalized=true;localChild.controller.abort();onResult(first.value,{pendingOnline:false,pendingLocal:false});return first.value;
  }
  cloudChild.controller.abort();
  if(first.kind==='cloudError')onStatus({stage:'offlineFallback',error:first.error});
  const local=localResult?{kind:'local',value:localResult}:await localTask;
  if(signal?.aborted)throw abortError();
  if(local.kind==='localError')throw local.error;
  finalized=true;onResult(local.value,{pendingOnline:false,pendingLocal:false});return local.value;
 }finally{
  finalized=true;localChild.controller.abort();cloudChild.controller.abort();localChild.clean();cloudChild.clean();
 }
}
