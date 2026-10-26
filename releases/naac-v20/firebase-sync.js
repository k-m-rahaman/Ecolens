/* Firebase transports anonymous institution totals; no personal ledger is sent. */
import { INSTITUTIONS } from './data.js';
import { PUBLIC_REVISION_KEY } from './public-sync.js';

export const FIREBASE_AUTH_KEY_PREFIX = 'ecolens-naac-firebase-auth-v1:';
export const FIREBASE_TOTAL_FIELDS = Object.freeze(['contributingProfiles','completedQuests','itemsHandled','estimatedMicroKg','estimatedCo2MicroKg','reportedDivertedMicroKg','assumedDivertedMicroKg']);
const COUNTS = new Set(FIREBASE_TOTAL_FIELDS.slice(0,3));
const KG_FIELDS = ['estimatedKg','estimatedCo2Kg','reportedDivertedKg','assumedDivertedKg'];
const KNOWN = new Set(INSTITUTIONS.map(row=>row.id));
const ERROR_TEXT = {
  INVALID_ENDPOINT:'Use the Firebase public report address.', INVALID_SNAPSHOT:'Only valid anonymous institution totals can be shared.',
  PUBLIC_RESPONSE:'The public report returned an unexpected response.', PUBLIC_NETWORK:'The public report is unavailable. Your private records remain saved.',
  REQUEST_CANCELLED:'Public sharing was cancelled.', SHARING_DISABLED:'The Firebase public report is not configured.',
  IDENTITY_UNAVAILABLE:'The original anonymous sharing identity is unavailable. Its earlier contribution cannot be removed from this browser.',
  INVALID_TOKEN:'The saved anonymous sharing identity could not be renewed.', RATE_LIMIT:'Public sharing is temporarily limited. Try again later.'
};
function fail(code,status) { const error=new Error(ERROR_TEXT[code]||ERROR_TEXT.PUBLIC_NETWORK);error.code=code;if(status)error.status=status;return error; }
function aborted(signal) { if(signal?.aborted)throw fail('REQUEST_CANCELLED'); }
function exact(value,keys) {return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&Object.keys(value).every(key=>keys.includes(key));}
function hostedOrigin(value) {
  try {const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.port||url.search||url.hash||url.pathname!=='/'||!/^([a-z0-9-]+)\.(web\.app|firebaseapp\.com)$/.test(url.hostname))throw new Error();return url.origin;}
  catch {throw fail('INVALID_ENDPOINT');}
}
export function validateFirebaseConfig(value,endpoint) {
  const base=hostedOrigin(endpoint);
  if(!exact(value,['version','provider','projectId','apiKey','databaseURL'])||value.version!==1||value.provider!=='firebase'||!/^([a-z][a-z0-9-]{4,28}[a-z0-9])$/.test(value.projectId)||!/^AIza[A-Za-z0-9_-]{35}$/.test(value.apiKey))throw fail('SHARING_DISABLED');
  const site=new URL(base).hostname.replace(/\.(?:web\.app|firebaseapp\.com)$/,'');
  const permittedSites=new RegExp(`^${value.projectId}(?:-naac(?:-[a-z0-9]{4,12})?)?$`);
  if(!permittedSites.test(site))throw fail('SHARING_DISABLED');
  let database;
  try {database=new URL(value.databaseURL);if(database.protocol!=='https:'||database.username||database.password||database.port||database.search||database.hash||database.pathname!=='/')throw new Error();}
  catch {throw fail('SHARING_DISABLED');}
  const legacy=new Set([`${value.projectId}.firebaseio.com`,`${value.projectId}-default-rtdb.firebaseio.com`]);
  const regional=new RegExp(`^${value.projectId}-default-rtdb\\.[a-z]+-[a-z]+[0-9]\\.firebasedatabase\\.app$`);
  if(!legacy.has(database.hostname)&&!regional.test(database.hostname))throw fail('SHARING_DISABLED');
  return {...value,databaseURL:database.origin};
}
function numericRow(value,{publicRow=false}={}) {
  const keys=[...FIREBASE_TOTAL_FIELDS,...(publicRow?[]:['revision']),'updatedAt'];
  if(!exact(value,keys))throw fail('PUBLIC_RESPONSE');
  const clean={};
  for(const field of FIREBASE_TOTAL_FIELDS){const maximum=publicRow?(COUNTS.has(field)?1_000_000_000:1_000_000_000_000_000):(field==='contributingProfiles'?1000:COUNTS.has(field)?1_000_000:1_000_000_000_000);const number=value[field];if(!Number.isSafeInteger(number)||number<0||number>maximum)throw fail('PUBLIC_RESPONSE');clean[field]=number;}
  if(clean.estimatedMicroKg!==clean.reportedDivertedMicroKg+clean.assumedDivertedMicroKg)throw fail('PUBLIC_RESPONSE');
  if(!Number.isSafeInteger(value.updatedAt)||value.updatedAt<1)throw fail('PUBLIC_RESPONSE');clean.updatedAt=value.updatedAt;
  if(!publicRow){if(!Number.isSafeInteger(value.revision)||value.revision<1)throw fail('PUBLIC_RESPONSE');clean.revision=value.revision;}
  return clean;
}
function rows(value,options) {
  if(value===null)return new Map();
  if(!value||typeof value!=='object'||Array.isArray(value))throw fail('PUBLIC_RESPONSE');
  return new Map(Object.entries(value).map(([id,row])=>{if(!KNOWN.has(id))throw fail('PUBLIC_RESPONSE');return [id,numericRow(row,options)];}));
}
function publisherMarker(value) {
  if(value===null)return {revision:0,updatedAt:0};
  if(!exact(value,['revision','updatedAt'])||!Number.isSafeInteger(value.revision)||value.revision<1||!Number.isSafeInteger(value.updatedAt)||value.updatedAt<1)throw fail('PUBLIC_RESPONSE');
  return value;
}
const zero=()=>Object.fromEntries(FIREBASE_TOTAL_FIELDS.map(field=>[field,0]));
export function firebaseSnapshotRows(snapshot) {
  const fields=['institutionId','contributingProfiles','completedQuests','itemsHandled',...KG_FIELDS];
  if(!exact(snapshot,['version','revision','institutions'])||snapshot.version!==1||!Number.isSafeInteger(snapshot.revision)||snapshot.revision<1||!Array.isArray(snapshot.institutions)||snapshot.institutions.length>KNOWN.size)throw fail('INVALID_SNAPSHOT');
  const result=new Map();
  for(const row of snapshot.institutions){
    if(!exact(row,fields)||!KNOWN.has(row.institutionId)||result.has(row.institutionId))throw fail('INVALID_SNAPSHOT');
    const clean={};
    for(const field of FIREBASE_TOTAL_FIELDS.slice(0,3)){const number=row[field];if(!Number.isSafeInteger(number)||number<0||number>(field==='contributingProfiles'?1000:1_000_000))throw fail('INVALID_SNAPSHOT');clean[field]=number;}
    for(const [index,field]of KG_FIELDS.entries()){const number=row[field];if(typeof number!=='number'||!Number.isFinite(number)||number<0||number>1_000_000)throw fail('INVALID_SNAPSHOT');clean[FIREBASE_TOTAL_FIELDS[index+3]]=Math.round(number*1_000_000);}
    if(clean.estimatedMicroKg!==clean.reportedDivertedMicroKg+clean.assumedDivertedMicroKg)throw fail('INVALID_SNAPSHOT');
    result.set(row.institutionId,clean);
  }
  return result;
}
function tokenSubject(idToken,projectId,uid) {
  try {const parts=idToken.split('.');if(parts.length!==3)throw new Error();const encoded=parts[1].replaceAll('-','+').replaceAll('_','/');const body=JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length/4)*4,'=')));return body.aud===projectId&&body.sub===uid&&body.iss===`https://securetoken.google.com/${projectId}`;}
  catch{return false;}
}

export function createFirebasePublishTransport({storage=globalThis.localStorage,fetchImpl=globalThis.fetch,now=Date.now,maxAttempts=3}={}) {
  const configurations=new Map();let serial=Promise.resolve();
  const attempts=Number.isInteger(maxAttempts)&&maxAttempts>0?Math.min(maxAttempts,3):3;
  async function request(url,options={},signal) {
    aborted(signal);if(typeof fetchImpl!=='function')throw fail('PUBLIC_NETWORK');
    let rejectAbort;
    const cancelled=new Promise((_,reject)=>{rejectAbort=reject;});
    const cancel=()=>rejectAbort(fail('REQUEST_CANCELLED'));signal?.addEventListener('abort',cancel,{once:true});
    try {
      const operation=(async()=>{
        let response;
        try{response=await fetchImpl(url,{credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',...options,signal});}catch{throw fail(signal?.aborted?'REQUEST_CANCELLED':'PUBLIC_NETWORK');}
        aborted(signal);
        let value;try{value=await response.json();}catch{throw fail('PUBLIC_RESPONSE');}
        aborted(signal);
        if(!response.ok){const code=response.status===429?'RATE_LIMIT':response.status===401?'INVALID_TOKEN':response.status===403?'PUBLIC_NETWORK':'PUBLIC_NETWORK';throw fail(code,response.status);}
        return value;
      })();
      return await Promise.race([operation,cancelled]);
    }finally{signal?.removeEventListener('abort',cancel);}
  }
  async function config(endpoint,signal) {
    const origin=hostedOrigin(endpoint);
    if(!configurations.has(origin)){const value=await request(`${origin}/firebase-config.json`,{},signal);configurations.set(origin,validateFirebaseConfig(value,origin));}
    return configurations.get(origin);
  }
  function authKey(config){return `${FIREBASE_AUTH_KEY_PREFIX}${config.projectId}:${new URL(config.databaseURL).hostname}`;}
  function storedIdentity(config) {
    let text;
    try{text=storage?.getItem(authKey(config));}catch{throw fail('IDENTITY_UNAVAILABLE');}
    if(text===null||text===undefined)return null;
    let value;try{value=JSON.parse(text);}catch{throw fail('IDENTITY_UNAVAILABLE');}
    if(!exact(value,['version','projectId','databaseURL','uid','idToken','refreshToken','expiresAt'])||value.version!==1||value.projectId!==config.projectId||value.databaseURL!==config.databaseURL||!/^[-A-Za-z0-9_]{1,128}$/.test(value.uid)||typeof value.refreshToken!=='string'||!value.refreshToken||value.refreshToken.length>8192||typeof value.idToken!=='string'||!tokenSubject(value.idToken,config.projectId,value.uid)||!Number.isSafeInteger(value.expiresAt)||value.expiresAt<1)throw fail('IDENTITY_UNAVAILABLE');
    return value;
  }
  function saveIdentity(config,value) {
    const body=JSON.stringify(value);
    try{storage.setItem(authKey(config),body);if(storage.getItem(authKey(config))!==body)throw new Error();}catch{throw fail('IDENTITY_UNAVAILABLE');}
    return value;
  }
  function rememberRemoteRevision(revision) {
    try {
      const current=Number(storage?.getItem(PUBLIC_REVISION_KEY));
      const next=Math.max(Number.isSafeInteger(current)&&current>0?current:0,revision);
      storage.setItem(PUBLIC_REVISION_KEY,String(next));
      if(Number(storage.getItem(PUBLIC_REVISION_KEY))!==next)throw new Error();
    }catch{throw fail('IDENTITY_UNAVAILABLE');}
  }
  function authReply(config,reply,{refresh=false,previous}={}) {
    const uid=refresh?reply.user_id:reply.localId,idToken=refresh?reply.id_token:reply.idToken,refreshToken=refresh?reply.refresh_token:reply.refreshToken,expiry=Number(refresh?reply.expires_in:reply.expiresIn);
    if(!/^[-A-Za-z0-9_]{1,128}$/.test(uid||'')||typeof idToken!=='string'||typeof refreshToken!=='string'||!refreshToken||refreshToken.length>8192||!Number.isSafeInteger(expiry)||expiry<1||expiry>86400||!tokenSubject(idToken,config.projectId,uid)||(previous&&uid!==previous.uid)||(refresh&&reply.project_id!==config.projectId&&!/^\d+$/.test(reply.project_id||'')))throw fail('INVALID_TOKEN');
    return saveIdentity(config,{version:1,projectId:config.projectId,databaseURL:config.databaseURL,uid,idToken,refreshToken,expiresAt:now()+expiry*1000});
  }
  async function identity(config,{revoke,signal}) {
    const previous=storedIdentity(config);
    if(!previous){
      if(revoke)throw fail('IDENTITY_UNAVAILABLE');
      const reply=await request(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(config.apiKey)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({returnSecureToken:true})},signal);
      return authReply(config,reply);
    }
    if(previous.expiresAt>now()+60_000)return previous;
    const body=new URLSearchParams({grant_type:'refresh_token',refresh_token:previous.refreshToken}).toString();
    const reply=await request(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(config.apiKey)}`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body},signal);
    return authReply(config,reply,{refresh:true,previous});
  }
  const accepted=stamp=>({version:1,published:true,updatedAt:new Date(stamp||now()).toISOString()});
  async function publish({endpoint,snapshot,signal,revoke=false}) {
    aborted(signal);const next=firebaseSnapshotRows(snapshot),configuration=await config(endpoint,signal),auth=await identity(configuration,{revoke,signal});
    const publicUrl=`${configuration.databaseURL}/ecolensNaacV1/publicInstitutions.json`;
    const authQuery=`?auth=${encodeURIComponent(auth.idToken)}`;
    const ownUrl=`${configuration.databaseURL}/ecolensNaacV1/contributions/${encodeURIComponent(auth.uid)}.json${authQuery}`;
    const markerUrl=`${configuration.databaseURL}/ecolensNaacV1/publishers/${encodeURIComponent(auth.uid)}.json${authQuery}`;
    for(let attempt=0;attempt<attempts;attempt++){
      aborted(signal);
      const [publicValue,ownValue,markerValue]=await Promise.all([request(publicUrl,{},signal),request(ownUrl,{},signal),request(markerUrl,{},signal)]);
      const current=rows(publicValue,{publicRow:true}),previous=rows(ownValue),marker=publisherMarker(markerValue);
      const highest=Math.max(marker.revision,...[...previous.values()].map(row=>row.revision));
      if(snapshot.revision<=highest){
        if(revoke&&[...previous.values()].some(row=>FIREBASE_TOTAL_FIELDS.some(field=>row[field]!==0))){
          // Retain the pending removal. A later explicit retry must allocate a
          // newer revision; this stale request cannot remove a newer snapshot.
          rememberRemoteRevision(highest);
          throw fail('PUBLIC_RESPONSE');
        }
        return accepted(Math.max(marker.updatedAt,...[...previous.values()].map(row=>row.updatedAt)));
      }
      const ids=new Set([...previous.keys(),...next.keys()]);
      // A global private marker also blocks stale writes for previously unseen IDs.
      const patch={[`publishers/${auth.uid}`]:{revision:snapshot.revision,updatedAt:{'.sv':'timestamp'}}};
      for(const id of ids){
        const old=previous.get(id)||zero(),own=next.get(id)||zero(),total=current.get(id)||zero(),aggregate={};
        for(const field of FIREBASE_TOTAL_FIELDS){const number=total[field]+own[field]-old[field],maximum=COUNTS.has(field)?1_000_000_000:1_000_000_000_000_000;if(!Number.isSafeInteger(number)||number<0||number>maximum)throw fail('PUBLIC_RESPONSE');aggregate[field]=number;}
        patch[`publicInstitutions/${id}`]={...aggregate,updatedAt:{'.sv':'timestamp'}};
        patch[`contributions/${auth.uid}/${id}`]={...own,revision:snapshot.revision,updatedAt:{'.sv':'timestamp'}};
      }
      try{
        const reply=await request(`${configuration.databaseURL}/ecolensNaacV1.json${authQuery}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(patch)},signal);
        const stamps=Object.values(reply||{}).map(row=>row?.updatedAt).filter(value=>Number.isSafeInteger(value)&&value>0);
        return accepted(stamps.length?Math.max(...stamps):now());
      }catch(error){if(![401,403].includes(error.status)||attempt===attempts-1)throw error;}
    }
    throw fail('PUBLIC_NETWORK');
  }
  return options=>{const pending=serial.then(()=>publish(options));serial=pending.catch(()=>{});return pending;};
}
