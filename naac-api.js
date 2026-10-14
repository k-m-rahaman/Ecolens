/* Shared reporting accepts aggregate numbers only. Personal records never belong in this API. */
import { INSTITUTIONS } from './data.js';

export const NAAC_BODY_LIMIT = 25_000;
export const NAAC_FIELDS = Object.freeze(['contributingProfiles', 'completedQuests', 'itemsHandled', 'estimatedKg', 'estimatedCo2Kg', 'reportedDivertedKg', 'assumedDivertedKg']);
const COUNTS = new Set(['contributingProfiles', 'completedQuests', 'itemsHandled']);
const CATALOG = new Map(INSTITUTIONS.map(({id, name, type, area}) => [id, {institutionId:id, name, type, area}]));
const ERROR_TEXT = {
  SHARING_DISABLED:'Public NAAC sharing has not been configured.',
  INVALID_SNAPSHOT:'Only valid anonymous institution totals are accepted.',
  PAYLOAD_TOO_LARGE:'The report exceeds the upload limit.',
  INVALID_JSON:'A JSON report is required.',
  ORIGIN_DENIED:'This website cannot publish to this report.',
  INVALID_TOKEN:'An anonymous installation token is required.',
  RATE_LIMIT:'Report publishing is temporarily limited. Try again later.',
  STORAGE_UNAVAILABLE:'Shared reporting is temporarily unavailable.',
  NOT_FOUND:'This endpoint does not exist.',
  METHOD_NOT_ALLOWED:'This request method is not supported.'
};
export function naacError(code, status=400) { const error=new Error(ERROR_TEXT[code]||ERROR_TEXT.STORAGE_UNAVAILABLE); error.code=code; error.status=status; return error; }
function exactKeys(value, keys) { return value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).length===keys.length && Object.keys(value).every(key=>keys.includes(key)); }
export function validateSnapshot(value) {
  if(!exactKeys(value,['version','revision','institutions']) || value.version!==1 || !Number.isSafeInteger(value.revision) || value.revision<1 || !Array.isArray(value.institutions) || value.institutions.length>CATALOG.size) throw naacError('INVALID_SNAPSHOT');
  const seen=new Set();
  const institutions=value.institutions.map(row=>{
    if(!exactKeys(row,['institutionId',...NAAC_FIELDS]) || !CATALOG.has(row.institutionId) || seen.has(row.institutionId)) throw naacError('INVALID_SNAPSHOT');
    seen.add(row.institutionId);
    const clean={institutionId:row.institutionId};
    for(const field of NAAC_FIELDS) {
      const number=row[field], maximum=field==='contributingProfiles'?1000:1_000_000;
      if(typeof number!=='number'||!Number.isFinite(number)||number<0||number>maximum||(COUNTS.has(field)&&!Number.isSafeInteger(number))) throw naacError('INVALID_SNAPSHOT');
      clean[field]=number===0?0:number;
    }
    const sum=clean.reportedDivertedKg+clean.assumedDivertedKg;
    if(Math.abs(clean.estimatedKg-sum)>0.000001*Math.max(1,sum)) throw naacError('INVALID_SNAPSHOT');
    return clean;
  });
  return {version:1,revision:value.revision,institutions};
}
export async function hashSecret(value) {
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}
export function allowedNaacOrigin(origin, env={}) {
  if(!origin || origin==='null') return false;
  return String(env.NAAC_ALLOWED_ORIGINS||'').split(',').map(value=>value.trim()).filter(Boolean).some(value=>{
    try { const url=new URL(value); return url.origin===value && ['https:','http:'].includes(url.protocol) && value===origin; } catch { return false; }
  });
}
function cap(value,fallback,maximum){const number=Number(value);return Number.isInteger(number)&&number>0?Math.min(number,maximum):fallback;}
export function quotaPolicy(env={}) {return {perMinute:cap(env.NAAC_PUBLISHES_PER_MINUTE,4,10),perDay:cap(env.NAAC_PUBLISHES_PER_IP_DAY,60,200),globalDay:cap(env.NAAC_PUBLISHES_PER_DAY,1000,5000)};}
async function readSnapshot(request) {
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type')||'')) throw naacError('INVALID_JSON',415);
  const advertised=Number(request.headers.get('Content-Length'));
  if(Number.isFinite(advertised)&&advertised>NAAC_BODY_LIMIT) throw naacError('PAYLOAD_TOO_LARGE',413);
  const reader=request.body?.getReader(); if(!reader)throw naacError('INVALID_JSON');
  const chunks=[];let length=0;
  try { for(;;){const {value,done}=await reader.read();if(done)break;length+=value.byteLength;if(length>NAAC_BODY_LIMIT){await reader.cancel();throw naacError('PAYLOAD_TOO_LARGE',413);}chunks.push(value);} }
  finally { reader.releaseLock(); }
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try{return validateSnapshot(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));}catch(error){if(error.code==='INVALID_SNAPSHOT')throw error;throw naacError('INVALID_JSON');}
}
export async function publicNaacSummary(store) {
  const {rows,updatedAt}=await store.aggregatedRows();
  const stored=new Map(rows.map(row=>[row.institutionId,row]));
  return {version:1,source:'shared',scope:'public-institution-aggregates',updatedAt:updatedAt||null,institutions:[...CATALOG.values()].map(institution=>{
    const row=stored.get(institution.institutionId)||{};
    const result={...institution};
    for(const field of NAAC_FIELDS){const number=Number(row[field]||0);if(!Number.isFinite(number)||number<0)throw naacError('STORAGE_UNAVAILABLE',503);result[field]=Math.round(number*1e6)/1e6;}
    result.hasRecords=NAAC_FIELDS.some(field=>result[field]>0);
    return result;
  })};
}
export async function handleNaacRequest(request, env={}, {store,client='unknown',now=()=>new Date()}={}) {
  const url=new URL(request.url),origin=request.headers.get('Origin')||'';
  const publicRead=['/api/naac/summary','/api/naac/status'].includes(url.pathname);
  const permitted=allowedNaacOrigin(origin,env);
  const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
  if(publicRead)headers['Access-Control-Allow-Origin']='*';
  else if(permitted){headers['Access-Control-Allow-Origin']=origin;headers.Vary='Origin';}
  const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
  try {
    if(!['/api/naac/summary','/api/naac/status','/api/naac/publish'].includes(url.pathname))throw naacError('NOT_FOUND',404);
    if(request.method==='OPTIONS'){
      if(!permitted)throw naacError('ORIGIN_DENIED',403);
      return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Max-Age':'600','Vary':'Origin'}});
    }
    if(publicRead && request.method!=='GET')throw naacError('METHOD_NOT_ALLOWED',405);
    if(url.pathname==='/api/naac/status')return reply({version:1,available:env.NAAC_SHARING_ENABLED==='1'&&Boolean(store),scope:'public-institution-aggregates'});
    if(env.NAAC_SHARING_ENABLED!=='1'||!store)throw naacError('SHARING_DISABLED',503);
    if(url.pathname==='/api/naac/summary')return reply(await publicNaacSummary(store));
    if(request.method!=='POST')throw naacError('METHOD_NOT_ALLOWED',405);
    if(!permitted)throw naacError('ORIGIN_DENIED',403);
    const bearer=/^Bearer ([a-f0-9]{48})$/.exec(request.headers.get('Authorization')||'');
    if(!bearer)throw naacError('INVALID_TOKEN',401);
    const snapshot=await readSnapshot(request);
    const date=now(); if(!(date instanceof Date)||!Number.isFinite(date.getTime()))throw naacError('STORAGE_UNAVAILABLE',503);
    const updatedAt=date.toISOString(),publisherHash=await hashSecret(bearer[1]),clientHash=await hashSecret(String(client));
    const stored=await store.replacePublisher(publisherHash,snapshot,{updatedAt,clientHash,limits:quotaPolicy(env)});
    return reply({version:1,published:true,updatedAt:stored?.updatedAt||updatedAt});
  } catch(error) {
    const code=Object.hasOwn(ERROR_TEXT,error?.code)?error.code:'STORAGE_UNAVAILABLE';
    if(code==='RATE_LIMIT')headers['Retry-After']='60';
    return reply({error:{code,message:ERROR_TEXT[code]}},Object.hasOwn(ERROR_TEXT,error?.code)?error.status||503:503);
  }
}
