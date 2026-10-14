import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { buildPublicSnapshot, createPublicSync, validatePublicEndpoint, PUBLIC_IDENTITY_KEY, PUBLIC_REVISION_KEY, PUBLIC_REMOVALS_KEY, PUBLIC_SYNC_TIMEOUT_MS } from './public-sync.js';
import { INSTITUTIONS } from './data.js';
import { loadAppState, addProfile, completeQuest, exportState, importState, STORAGE_KEY } from './core.js';
import { validateSnapshot, handleNaacRequest, NAAC_FIELDS } from './naac-api.js';

const endpoint = 'https://reports.example';
const stamp = '2026-10-13T12:00:00Z';
function memoryStorage() { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key), values }; }
function sampleState() {
  const state = loadAppState({getItem:()=>null});
  const alice = addProfile(state, {name:'Private Alice',institutionId:'brainware'});
  const bob = addProfile(state, {name:'Private Bob',institutionId:'brainware'});
  const custom = addProfile(state, {name:'Private Carol',institutionId:'other',customInstitution:'Private custom school'});
  const record = (profile, id, route, weightGrams) => completeQuest(state, {id, profileId:profile.id, kind:'sort', source:'manual', timestamp:stamp, components:[{name:'Private item description',material:route==='organic'?'organic':'paper',route,confidence:1,confirmedByUser:true}], ...(weightGrams===undefined?{}:{weightGrams})});
  record(alice,'private-event-alice','recycle',500);
  record(bob,'private-event-bob','organic');
  record(custom,'private-event-custom','recycle',500);
  return state;
}
const success = () => new Response(JSON.stringify({version:1,published:true,updatedAt:stamp}), {status:200,headers:{'Content-Type':'application/json'}});
const client = (storage, fetchImpl, extra={}) => createPublicSync({storage,fetchImpl,cryptoImpl:webcrypto,...extra});
const code = expected => error => error.code === expected;
const withRevision = (snapshot, revision=1) => ({version:snapshot.version,revision,institutions:snapshot.institutions});
const withoutRevision = ({revision,...snapshot}) => snapshot;

test('public payload is a strict whitelist of anonymous known-campus aggregates', () => {
  const state=sampleState(), before=JSON.stringify(state), snapshot=buildPublicSnapshot(state,INSTITUTIONS);
  assert.deepEqual(snapshot, {version:1,institutions:[{institutionId:'brainware',contributingProfiles:2,completedQuests:2,itemsHandled:2,estimatedKg:.58,estimatedCo2Kg:.574,reportedDivertedKg:.5,assumedDivertedKg:.08}]});
  const body=JSON.stringify(snapshot);
  for(const forbidden of ['Private','profileId','timestamp','fingerprint','event','corrections','xp','photo','name','customInstitution','settings']) assert.equal(body.includes(forbidden),false,forbidden);
  assert.deepEqual(Object.keys(snapshot.institutions[0]),['institutionId',...NAAC_FIELDS]);
  assert.equal(JSON.stringify(state),before);
  assert.deepEqual(validateSnapshot(withRevision(snapshot)),withRevision(snapshot));
});

test('empty institutions and invented custom catalog rows are never published', () => {
  const state=loadAppState({getItem:()=>null});
  assert.deepEqual(buildPublicSnapshot(state),{version:1,institutions:[]});
  assert.deepEqual(buildPublicSnapshot(sampleState(),[...INSTITUTIONS,{id:'other',name:'Private custom school',type:'school'}]),buildPublicSnapshot(sampleState()));
});

test('public diversion parts remain consistent after rounding', () => {
  const state=sampleState();state.events[0].weightGrams=.3333333333;state.events[1].weightGrams=.4444444444;
  const snapshot=buildPublicSnapshot(state);
  assert.deepEqual(validateSnapshot(withRevision(snapshot)),withRevision(snapshot));
  const row=snapshot.institutions[0];assert.ok(Math.abs(row.estimatedKg-row.reportedDivertedKg-row.assumedDivertedKg)<1e-9);
});

test('disabled sharing performs no request, no identity generation and no endpoint processing', async () => {
  const storage=memoryStorage();let calls=0;
  const sync=client(storage,()=>{calls++;throw new Error();});
  assert.deepEqual(await sync.sync(null,{enabled:false,endpoint:'bad'}),{status:'disabled'});
  assert.equal(calls,0);assert.equal(storage.values.size,0);
});

test('HTTPS and local origins normalize, while unsafe or non-base addresses are rejected', () => {
  assert.equal(validatePublicEndpoint(' https://reports.example/ '),endpoint);
  assert.equal(validatePublicEndpoint('http://localhost:8787'),'http://localhost:8787');
  assert.equal(validatePublicEndpoint('http://127.0.0.1:8787/'),'http://127.0.0.1:8787');
  assert.equal(validatePublicEndpoint('http://[::1]:8787/'),'http://[::1]:8787');
  for(const value of ['',null,'javascript:alert(1)','http://reports.example','https://user:password@reports.example','https://reports.example/api/naac','https://reports.example/?a=b','https://reports.example/#private','http://localhost.evil.example','http://192.168.1.8']) assert.throws(()=>validatePublicEndpoint(value),code('INVALID_ENDPOINT'));
});

test('identity is saved separately; requests omit cookies, personal state and referrer', async () => {
  const storage=memoryStorage(),state=sampleState();let sent;
  const sync=client(storage,async(url,options)=>{sent={url,options};return success();});
  assert.equal((await sync.sync(state,{enabled:true,endpoint})).status,'published');
  const secret=storage.getItem(PUBLIC_IDENTITY_KEY);assert.match(secret,/^[a-f0-9]{48}$/);
  assert.equal(storage.getItem(STORAGE_KEY),null);assert.deepEqual([...storage.values.keys()],[PUBLIC_IDENTITY_KEY,PUBLIC_REVISION_KEY]);
  assert.equal(sent.url,`${endpoint}/api/naac/publish`);assert.equal(sent.options.method,'POST');
  assert.equal(sent.options.headers.Authorization,`Bearer ${secret}`);assert.equal(sent.options.credentials,'omit');assert.equal(sent.options.referrerPolicy,'no-referrer');
  const payload=JSON.parse(sent.options.body);
  assert.equal(sent.options.cache,'no-store');assert.deepEqual(withoutRevision(payload),buildPublicSnapshot(state));
  assert.equal(Number.isSafeInteger(payload.revision),true);assert.equal(payload.revision>0,true);assert.equal(payload.revision,Number(storage.getItem(PUBLIC_REVISION_KEY)));
  assert.equal(sent.options.body.includes(secret),false);
});

test('separate browsers use independent identities and the same browser reuses its identity', async () => {
  const first=memoryStorage(),second=memoryStorage(),seen=[];
  const fetchImpl=async(url,options)=>{seen.push(options.headers.Authorization);return success();};
  await client(first,fetchImpl).sync(sampleState(),{enabled:true,endpoint});
  await client(second,fetchImpl).sync(sampleState(),{enabled:true,endpoint});
  await client(first,fetchImpl).sync(sampleState(),{enabled:true,endpoint});
  assert.notEqual(seen[0],seen[1]);assert.equal(seen[0],seen[2]);
});

test('exporting and importing personal backups never includes a sharing identity', async () => {
  const storage=memoryStorage(),state=sampleState();
  await client(storage,async()=>success()).sync(state,{enabled:true,endpoint});
  const backup=exportState(state),secret=storage.getItem(PUBLIC_IDENTITY_KEY);
  assert.equal(backup.includes(secret),false);assert.equal(backup.includes(PUBLIC_IDENTITY_KEY),false);assert.equal(backup.includes(PUBLIC_REVISION_KEY),false);
  assert.equal(JSON.stringify(importState(backup)).includes(secret),false);
});

test('duplicate successful snapshots are skipped per endpoint; changed totals replace rather than append', async () => {
  const storage=memoryStorage(),state=sampleState(),bodies=[];
  const sync=client(storage,async(url,options)=>{bodies.push({url,body:JSON.parse(options.body)});return success();});
  assert.equal((await sync.sync(state,{enabled:true,endpoint})).status,'published');
  assert.equal((await sync.sync(state,{enabled:true,endpoint:`${endpoint}/`})).status,'unchanged');
  state.events[0].weightGrams=1000;
  assert.equal((await sync.sync(state,{enabled:true,endpoint})).status,'published');
  await sync.sync(state,{enabled:true,endpoint:'https://another.example'});
  assert.equal(bodies.length,3);assert.equal(bodies[1].body.institutions[0].estimatedKg,1.08);
  assert.equal(bodies[0].body.institutions[0].estimatedKg,.58);
});

test('revoke sends an empty replacement with the original identity and later sharing publishes again', async () => {
  const storage=memoryStorage(),state=sampleState(),requests=[];
  const sync=client(storage,async(url,options)=>{requests.push(options);return success();});
  await sync.sync(state,{enabled:true,endpoint});
  assert.equal((await sync.revoke({endpoint})).status,'revoked');
  assert.deepEqual(withoutRevision(JSON.parse(requests[1].body)),{version:1,institutions:[]});
  assert.ok(JSON.parse(requests[1].body).revision>JSON.parse(requests[0].body).revision);
  assert.equal(requests[1].headers.Authorization,requests[0].headers.Authorization);
  assert.equal((await sync.sync(state,{enabled:true,endpoint})).status,'published');
  assert.equal(requests.length,3);
});

test('revoking without a previous anonymous identity does not create one or contact the server', async () => {
  const storage=memoryStorage();let calls=0;
  const result=await client(storage,async()=>{calls++;return success();}).revoke({endpoint});
  assert.equal(result.status,'revoked');assert.equal(result.skipped,true);assert.equal(calls,0);assert.equal(storage.values.size,0);
});

test('failed requests are retryable and remote details are not reflected to the user', async () => {
  const storage=memoryStorage(),revisions=[];let calls=0;
  const sync=client(storage,async(url,options)=>{calls++;revisions.push(JSON.parse(options.body).revision);if(calls===1)return new Response(JSON.stringify({error:{code:'RATE_LIMIT',message:'Private reflected text'}}),{status:429});return success();});
  await assert.rejects(sync.sync(sampleState(),{enabled:true,endpoint}),error=>error.code==='RATE_LIMIT'&&!error.message.includes('Private'));
  assert.equal((await sync.sync(sampleState(),{enabled:true,endpoint})).status,'published');assert.equal(calls,2);assert.equal(revisions[0],revisions[1]);
});

test('malformed successful responses do not suppress a later retry', async () => {
  const storage=memoryStorage();let calls=0;
  const sync=client(storage,async()=>{calls++;return calls===1?new Response('{}',{status:200}):success();});
  await assert.rejects(sync.sync(sampleState(),{enabled:true,endpoint}),code('PUBLIC_RESPONSE'));
  await sync.sync(sampleState(),{enabled:true,endpoint});assert.equal(calls,2);
});

test('hung fetch and hung response bodies time out and abort within the bounded interval', async () => {
  assert.equal(PUBLIC_SYNC_TIMEOUT_MS,8000);
  for(const response of [null,{ok:true,json:()=>new Promise(()=>{})}]){
    let signal;
    const sync=client(memoryStorage(),(url,options)=>{signal=options.signal;return response?Promise.resolve(response):new Promise(()=>{});},{timeoutMs:20});
    await assert.rejects(sync.sync(sampleState(),{enabled:true,endpoint}),code('PUBLIC_TIMEOUT'));
    assert.equal(signal.aborted,true);
  }
});

test('cancellation rejects promptly, aborts the request and does not deduplicate a later retry', async () => {
  const controller=new AbortController();let requestSignal,calls=0,started;
  const ready=new Promise(resolve=>{started=resolve;});
  const sync=client(memoryStorage(),(url,options)=>{calls++;requestSignal=options.signal;started();return calls===1?new Promise(()=>{}):Promise.resolve(success());});
  const pending=sync.sync(sampleState(),{enabled:true,endpoint,signal:controller.signal});await ready;controller.abort();
  await assert.rejects(pending,code('REQUEST_CANCELLED'));assert.equal(requestSignal.aborted,true);
  await sync.sync(sampleState(),{enabled:true,endpoint});assert.equal(calls,2);
});

test('aborted queued operations never send, and snapshots cannot finish out of order', async () => {
  const state=sampleState(),bodies=[];let release,started;
  const ready=new Promise(resolve=>{started=resolve;});
  const sync=client(memoryStorage(),async(url,options)=>{bodies.push(JSON.parse(options.body));if(bodies.length===1){started();await new Promise(resolve=>{release=resolve;});}return success();});
  const first=sync.sync(state,{enabled:true,endpoint});await ready;
  const controller=new AbortController();state.events[0].weightGrams=2000;
  const cancelled=sync.sync(state,{enabled:true,endpoint,signal:controller.signal});controller.abort();
  state.events[0].weightGrams=3000;
  const latest=sync.sync(state,{enabled:true,endpoint});assert.equal(bodies.length,1);release();
  await first;await assert.rejects(cancelled,code('REQUEST_CANCELLED'));await latest;
  assert.deepEqual(bodies.map(snapshot=>snapshot.institutions[0].estimatedKg),[.58,3.08]);
});

test('storage failures and missing secure randomness stop before network access', async () => {
  let calls=0;const fetchImpl=async()=>{calls++;return success();};
  await assert.rejects(client({getItem:()=>null,setItem:()=>{throw new Error();}},fetchImpl).sync(sampleState(),{enabled:true,endpoint}),code('IDENTITY_UNAVAILABLE'));
  await assert.rejects(createPublicSync({storage:memoryStorage(),fetchImpl,cryptoImpl:{}}).sync(sampleState(),{enabled:true,endpoint}),code('CRYPTO_UNAVAILABLE'));
  assert.equal(calls,0);
});

test('the real shared API accepts this client schema, replaces duplicates and reveals no identities', async () => {
  const entries=new Map();
  const store={async replacePublisher(hash,snapshot,options){if((entries.get(hash)?.snapshot.revision||0)<snapshot.revision)entries.set(hash,{snapshot,options});},async aggregatedRows(){return {rows:[...entries.values()].flatMap(value=>value.snapshot.institutions),updatedAt:stamp};}};
  const storage=memoryStorage();
  const fetchImpl=(url,options)=>handleNaacRequest(new Request(url,{...options,headers:{...options.headers,Origin:'https://app.example'}}),{NAAC_SHARING_ENABLED:'1',NAAC_ALLOWED_ORIGINS:'https://app.example'},{store,client:'test-client',now:()=>new Date(stamp)});
  const sync=client(storage,fetchImpl);await sync.sync(sampleState(),{enabled:true,endpoint});
  assert.equal(entries.size,1);await client(storage,fetchImpl).sync(sampleState(),{enabled:true,endpoint});assert.equal(entries.size,1);
  const response=await handleNaacRequest(new Request(`${endpoint}/api/naac/summary`),{NAAC_SHARING_ENABLED:'1'},{store});
  const summary=await response.json();assert.equal(summary.institutions.length,34);assert.equal(summary.institutions.find(row=>row.institutionId==='brainware').estimatedKg,.58);
  assert.equal(JSON.stringify(summary).includes(storage.getItem(PUBLIC_IDENTITY_KEY)),false);assert.equal(JSON.stringify(summary).includes('publisher'),false);
  await sync.revoke({endpoint});const revoked=await handleNaacRequest(new Request(`${endpoint}/api/naac/summary`),{NAAC_SHARING_ENABLED:'1'},{store});
  assert.equal((await revoked.json()).institutions.find(row=>row.institutionId==='brainware').hasRecords,false);
});

test('durable revisions increase across client instances, even when the previous value is in the future', async () => {
  const storage=memoryStorage(),revisions=[];
  storage.setItem(PUBLIC_REVISION_KEY,String(Date.now()+100000));
  const previous=Number(storage.getItem(PUBLIC_REVISION_KEY));
  const fetchImpl=async(url,options)=>{revisions.push(JSON.parse(options.body).revision);return success();};
  await client(storage,fetchImpl).sync(sampleState(),{enabled:true,endpoint});
  await client(storage,fetchImpl).sync(sampleState(),{enabled:true,endpoint});
  assert.deepEqual(revisions,[previous+1,previous+2]);
});

test('Web Locks coordinate publishing across tabs before allocating revisions', async () => {
  const storage=memoryStorage(),requests=[];let serial=Promise.resolve(),lockCalls=0;
  const locksImpl={request(name,options,operation){assert.equal(name,'ecolens-naac-publish-v1');assert.equal(options.mode,'exclusive');lockCalls++;const pending=serial.then(operation);serial=pending.catch(()=>{});return pending;}};
  const fetchImpl=async(url,options)=>{requests.push(JSON.parse(options.body));await new Promise(resolve=>setTimeout(resolve,5));return success();};
  const state=sampleState(),first=client(storage,fetchImpl,{locksImpl}),second=client(storage,fetchImpl,{locksImpl});
  const one=first.sync(state,{enabled:true,endpoint});
  state.events[0].weightGrams=1000;
  const two=second.sync(state,{enabled:true,endpoint});
  await Promise.all([one,two]);
  assert.equal(lockCalls,2);assert.deepEqual(requests.map(snapshot=>snapshot.institutions[0].estimatedKg),[.58,1.08]);assert.ok(requests[1].revision>requests[0].revision);
});

async function sharingHandler(state, sync, {address=endpoint,checked=false}={}) {
  const source=await readFile(new URL('./app.js',import.meta.url),'utf8');
  const start=source.indexOf('async function savePublicSharing(){'),end=source.indexOf('\nfunction speak()',start);
  assert.ok(start>=0&&end>start);
  const nodes={publicReportEndpoint:{value:address},shareInstitutionTotals:{checked}};
  const context=vm.createContext({state,publicSync:sync,publicBusy:false,publicStatusText:'',publicSyncTimer:null,$:id=>nodes[id],validatePublicEndpoint,effectivePublicEndpoint:()=>state.settings.publicReportEndpoint||endpoint,clearTimeout,save:()=>{},renderPublicSharing:()=>{},toast:message=>{throw new Error(message);},tr:value=>value});
  vm.runInContext(source.slice(start,end),context);
  return {context,nodes,run:()=>context.savePublicSharing()};
}

test('the real settings handler retries failed removal after sharing has already been turned off', async () => {
  const state=sampleState(),storage=memoryStorage(),requests=[];let connected=true;
  state.settings.publicReportEndpoint=endpoint;state.settings.shareInstitutionTotals=true;
  const fetchImpl=async(url,options)=>{requests.push({url,payload:JSON.parse(options.body)});if(!connected)throw new Error('offline');return success();};
  const sync=client(storage,fetchImpl);await sync.sync(state,{enabled:true,endpoint});
  connected=false;const handler=await sharingHandler(state,sync);
  await handler.run();
  assert.equal(state.settings.shareInstitutionTotals,false);assert.equal(handler.context.publicStatusText,'publicRemovalFailed');
  assert.deepEqual(sync.pendingRemovals(),[endpoint]);
  assert.deepEqual(client(storage,fetchImpl).pendingRemovals(),[endpoint]);
  const backup=exportState(state);assert.equal(backup.includes(PUBLIC_REMOVALS_KEY),false);assert.equal(backup.includes(storage.getItem(PUBLIC_IDENTITY_KEY)),false);
  connected=true;await handler.run();
  assert.equal(state.settings.shareInstitutionTotals,false);assert.equal(handler.context.publicStatusText,'publicSharingOff');
  assert.deepEqual(sync.pendingRemovals(),[]);assert.deepEqual(requests.at(-1).payload.institutions,[]);
  assert.equal(requests.at(-1).payload.revision,requests.at(-2).payload.revision);
});

test('switching service addresses preserves failed old removal and retries it on a later Save', async () => {
  const state=sampleState(),storage=memoryStorage(),requests=[],newEndpoint='https://new-reports.example';let oldAvailable=true;
  state.settings.publicReportEndpoint=endpoint;state.settings.shareInstitutionTotals=true;
  const fetchImpl=async(url,options)=>{requests.push({url,payload:JSON.parse(options.body)});if(url.startsWith(endpoint)&&!oldAvailable)throw new Error('offline');return success();};
  const sync=client(storage,fetchImpl);await sync.sync(state,{enabled:true,endpoint});
  oldAvailable=false;const handler=await sharingHandler(state,sync,{address:newEndpoint,checked:true});await handler.run();
  assert.equal(state.settings.shareInstitutionTotals,true);assert.equal(state.settings.publicReportEndpoint,newEndpoint);
  assert.equal(handler.context.publicStatusText,'publicOldRemovalFailed');assert.deepEqual(sync.pendingRemovals(),[endpoint]);
  assert.equal(requests.at(-1).url,`${newEndpoint}/api/naac/publish`);assert.equal(requests.at(-1).payload.institutions.length,1);
  oldAvailable=true;await handler.run();
  assert.equal(handler.context.publicStatusText,'publicSyncSuccess');assert.deepEqual(sync.pendingRemovals(),[]);
  const oldRemoval=requests.filter(request=>request.url===`${endpoint}/api/naac/publish`).at(-1);
  assert.deepEqual(oldRemoval.payload.institutions,[]);assert.ok(oldRemoval.payload.revision>requests[0].payload.revision);
  assert.equal(state.settings.shareInstitutionTotals,true);
});
