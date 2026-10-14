import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateCatalog,validateFirebaseConfig,firebasePublicSummary,mergeCatalog,aggregateTotals,reportCSV} from './naac/public.js';

const catalog=validateCatalog(JSON.parse(await readFile(new URL('./naac/catalog.json',import.meta.url),'utf8')));
const config={version:1,provider:'firebase',projectId:'ecolens-demo',apiKey:'AIza'+'a'.repeat(35),databaseURL:'https://ecolens-demo-default-rtdb.firebaseio.com'};
const timestamp=Date.parse('2026-10-13T08:00:00.000Z');
function totals(overrides={}){return {contributingProfiles:2,completedQuests:3,itemsHandled:4,estimatedMicroKg:1000001,estimatedCo2MicroKg:750000,reportedDivertedMicroKg:750001,assumedDivertedMicroKg:250000,updatedAt:timestamp,...overrides};}

test('Firebase public config permits only the configured project default HTTPS database',()=>{
 assert.equal(validateFirebaseConfig(config).databaseURL,config.databaseURL);
 assert.equal(validateFirebaseConfig({...config,databaseURL:'https://ecolens-demo.firebaseio.com/'}).databaseURL,'https://ecolens-demo.firebaseio.com');
 assert.equal(validateFirebaseConfig({...config,databaseURL:'https://ecolens-demo-default-rtdb.asia-southeast1.firebasedatabase.app/'}).databaseURL,'https://ecolens-demo-default-rtdb.asia-southeast1.firebasedatabase.app');
 for(const databaseURL of ['http://ecolens-demo.firebaseio.com','https://other-project.firebaseio.com','https://ecolens-demo.firebaseio.com.attacker.example','https://ecolens-demo.firebaseio.com/ecolensNaacV1','https://ecolens-demo.firebaseio.com?auth=secret','https://ecolens-demo.firebaseio.com#token','https://user:secret@ecolens-demo.firebaseio.com','https://ecolens-demo.firebaseio.com:8443','https://ecolens-demo.firebasedatabase.app'])assert.throws(()=>validateFirebaseConfig({...config,databaseURL}),/INVALID_FIREBASE_CONFIG/);
});
test('blank setup is explicitly unconfigured and service account fields cannot become public config',()=>{
 assert.equal(validateFirebaseConfig({version:1,provider:'firebase',projectId:'',apiKey:'',databaseURL:''}),null);
 assert.equal(validateFirebaseConfig({...config,apiKey:''}),null);
 for(const mutate of [value=>value.private_key='SECRET',value=>value.client_email='private@example.test',value=>value.provider='cloudflare',value=>value.version=2,value=>value.apiKey='-----BEGIN PRIVATE KEY-----',value=>value.projectId='../private',value=>value.databaseURL=null]){const value={...config};mutate(value);assert.throws(()=>validateFirebaseConfig(value),/INVALID_FIREBASE_CONFIG/);}
});
test('null and empty Firebase public nodes produce all 34 empty institution reports',()=>{
 for(const raw of [null,{}]){const result=firebasePublicSummary(raw,catalog);assert.equal(result.institutions.length,34);assert.equal(result.updatedAt,null);assert.equal(new Set(result.institutions.map(row=>row.institutionId)).size,34);assert.ok(result.institutions.every(row=>row.hasRecords===false&&row.estimatedKg===0));assert.equal(aggregateTotals(mergeCatalog(catalog,result)).itemsHandled,0);}
});
test('integer microkg totals preserve precision and use institution names from standalone catalog',()=>{
 const result=firebasePublicSummary({brainware:totals(),jadavpur:totals({updatedAt:timestamp+1000})},catalog),row=result.institutions.find(value=>value.institutionId==='brainware');
 assert.equal(row.name,'Brainware University');assert.equal(row.estimatedKg,1.000001);assert.equal(row.estimatedCo2Kg,.75);assert.equal(row.reportedDivertedKg,.750001);assert.equal(row.assumedDivertedKg,.25);assert.equal(row.hasRecords,true);assert.equal(result.updatedAt,'2026-10-13T08:00:01.000Z');assert.equal(result.institutions.find(value=>value.institutionId==='calcutta').hasRecords,false);
 const csv=reportCSV(mergeCatalog(catalog,result),{updatedAt:result.updatedAt});assert.ok(csv.includes('1.000001'));assert.ok(!/uid|revision|private|photo|student name/i.test(csv));
});
test('revoked zero aggregate tombstones show no records while retaining a real update timestamp',()=>{
 const zero=Object.fromEntries(Object.keys(totals()).map(key=>[key,key==='updatedAt'?timestamp:0]));const result=firebasePublicSummary({brainware:zero},catalog);assert.equal(result.institutions[0].hasRecords,false);assert.equal(result.institutions[0].estimatedKg,0);assert.equal(result.updatedAt,new Date(timestamp).toISOString());
});
test('Firebase public schema rejects private fields, server-supplied names and unknown institutions',()=>{
 for(const extra of ['name','institutionId','studentNames','photos','history','xp','profileId','uid','revision','token'])assert.throws(()=>firebasePublicSummary({brainware:{...totals(),[extra]:'PRIVATE'}},catalog),/INVALID_FIREBASE_REPORT/);
 for(const id of ['unknown-campus','__proto__','contributions']){const raw=JSON.parse(`{"${id}":${JSON.stringify(totals())}}`);assert.throws(()=>firebasePublicSummary(raw,catalog),/INVALID_FIREBASE_REPORT/);}
 for(const raw of [[],0,'private data',true])assert.throws(()=>firebasePublicSummary(raw,catalog),/INVALID_FIREBASE_REPORT/);
});
test('Firebase public schema rejects fractional, excessive or contradictory numeric totals',()=>{
 for(const overrides of [{itemsHandled:.5},{itemsHandled:-1},{itemsHandled:1e9+1},{estimatedMicroKg:1.5},{estimatedMicroKg:NaN},{estimatedCo2MicroKg:Infinity},{estimatedCo2MicroKg:1e15+1},{reportedDivertedMicroKg:0},{updatedAt:'2026-10-13'},{updatedAt:timestamp+.5},{updatedAt:-1},{updatedAt:8640000000000001}])assert.throws(()=>firebasePublicSummary({brainware:totals(overrides)},catalog),/INVALID_FIREBASE_REPORT/);
 const incomplete=totals();delete incomplete.itemsHandled;assert.throws(()=>firebasePublicSummary({brainware:incomplete},catalog),/INVALID_FIREBASE_REPORT/);
});
test('public report code has one aggregate read path and no auth, private node reads or live polling',async()=>{
 const source=await readFile(new URL('./naac/public.js',import.meta.url),'utf8');assert.ok(source.includes('/ecolensNaacV1/publicInstitutions.json'));assert.ok(!/identitytoolkit|securetoken|signInAnonymously|contributions\.json|Authorization|onValue\(|setInterval\(|\/api\/naac\/summary/.test(source));assert.ok(source.includes("credentials:'omit'"));
});
