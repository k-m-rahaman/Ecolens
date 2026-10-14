import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { INSTITUTIONS } from './data.js';
import { NAAC_FIELDS, NAAC_BODY_LIMIT, allowedNaacOrigin, hashSecret, handleNaacRequest, validateSnapshot } from './naac-api.js';
import { createJsonNaacStore, createD1NaacStore } from './naac-store.mjs';
import { createEcolensServer } from './server.mjs';
import worker from './naac-worker.mjs';

// The application runs on Node 20+. The transactional adapter tests use the
// built-in SQLite available in newer Node releases, without a package install.
const {DatabaseSync}=await import('node:sqlite').catch(()=>({}));

const ROOT=path.dirname(fileURLToPath(import.meta.url));
const FIXTURES=path.join(ROOT,'.ecolens','test-fixtures');
const ORIGIN='http://127.0.0.1:8787';
const ENV={NAAC_SHARING_ENABLED:'1',NAAC_ALLOWED_ORIGINS:ORIGIN};
const TOKEN_A='a'.repeat(48),TOKEN_B='b'.repeat(48);
const NOW=()=>new Date('2026-10-13T06:00:00.000Z');
const row=(index=0,kg=2)=>({institutionId:INSTITUTIONS[index].id,contributingProfiles:1,completedQuests:2,itemsHandled:3,estimatedKg:kg,estimatedCo2Kg:kg*1.5,reportedDivertedKg:kg*.75,assumedDivertedKg:kg*.25});
const snapshot=(rows=[row()],revision=1)=>({version:1,revision,institutions:rows});
const request=(route='/publish',value=snapshot(),token=TOKEN_A,origin=ORIGIN)=>new Request(`https://report.example/api/naac${route}`,{
  method:route==='/publish'?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',Authorization:`Bearer ${token}`},
  ...(route==='/publish'?{body:JSON.stringify(value)}:{})
});
async function fixture(t){await fs.mkdir(FIXTURES,{recursive:true});const dir=await fs.mkdtemp(path.join(FIXTURES,'naac-'));t.after(async()=>{assert.equal(path.dirname(dir),FIXTURES);await fs.rm(dir,{recursive:true,force:true});});return dir;}
async function send(store,value=snapshot(),token=TOKEN_A,client='test-client',env=ENV){return handleNaacRequest(request('/publish',value,token),env,{store,client,now:NOW});}
async function summary(store){return (await handleNaacRequest(request('/summary'),ENV,{store,now:NOW})).json();}
function d1Fixture(t){
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');t.after(()=>sqlite.close());
  const database={
    prepare(sql){return {sql,args:[],bind(...args){return {...this,args};}};},
    async batch(statements){
      sqlite.exec('BEGIN IMMEDIATE');
      try {const result=statements.map(({sql,args=[]})=>{const prepared=sqlite.prepare(sql);return {success:true,results:/^SELECT/i.test(sql)?prepared.all(...args):[],...( /^SELECT/i.test(sql)?{}:{meta:prepared.run(...args)})};});sqlite.exec('COMMIT');return result;}
      catch(error){sqlite.exec('ROLLBACK');throw error;}
    }
  };
  return {sqlite,database,store:createD1NaacStore(database)};
}
async function schema(t){const result=d1Fixture(t);result.sqlite.exec(await fs.readFile(path.join(ROOT,'naac-schema.sql'),'utf8'));return result;}
function nodeRequest(server,{url='/',method='GET',headers={},body=''}={}){
  return new Promise(resolve=>{
    const req=Readable.from(body?[Buffer.from(body)]:[]);Object.assign(req,{url,method,headers:{host:'127.0.0.1:8787',...headers},socket:{remoteAddress:'127.0.0.1'}});
    const res={headersSent:false,writeHead(status,headers){this.status=status;this.headers=headers;this.headersSent=true;},end(content){resolve({status:this.status,headers:this.headers,body:String(content||'')});}};
    server.emit('request',req,res);
  });
}

test('snapshot whitelist accepts totals and rejects names, photos, activity and unknown fields',()=>{
  assert.deepEqual(validateSnapshot(snapshot()),snapshot());
  for(const key of ['studentName','email','image','activity','xp','profileId','__proto__']){
    const value=snapshot();Object.defineProperty(value.institutions[0],key,{value:'private',enumerable:true});
    assert.throws(()=>validateSnapshot(value),{code:'INVALID_SNAPSHOT'});
  }
  assert.throws(()=>validateSnapshot({...snapshot(),student:'private'}),{code:'INVALID_SNAPSHOT'});
});
test('snapshot rejects nonfinite, negative, excessive, duplicate and contradictory totals',()=>{
  for(const patch of [{itemsHandled:.5},{estimatedKg:-1},{estimatedKg:Infinity},{estimatedKg:'2'},{contributingProfiles:1001},{estimatedKg:3}])assert.throws(()=>validateSnapshot(snapshot([{...row(),...patch}])),{code:'INVALID_SNAPSHOT'});
  assert.throws(()=>validateSnapshot(snapshot([row(),row()])),{code:'INVALID_SNAPSHOT'});
  assert.throws(()=>validateSnapshot(snapshot([{...row(),institutionId:'custom-private-name'}])),{code:'INVALID_SNAPSHOT'});
  assert.throws(()=>validateSnapshot({version:2,institutions:[]}),{code:'INVALID_SNAPSHOT'});
  for(const revision of [undefined,0,-1,1.5,'1',Number.MAX_SAFE_INTEGER+1])assert.throws(()=>validateSnapshot({...snapshot(),revision}),{code:'INVALID_SNAPSHOT'});
});
test('sharing stays disabled until explicitly configured; status is publicly readable',async()=>{
  let response=await handleNaacRequest(request('/status'),{},{});
  assert.equal(response.status,200);assert.equal((await response.json()).available,false);assert.equal(response.headers.get('Access-Control-Allow-Origin'),'*');
  response=await handleNaacRequest(request('/summary'),{},{});assert.equal(response.status,503);assert.equal((await response.json()).error.code,'SHARING_DISABLED');
});
test('CORS permits exact publishing origins and public read works from any origin',async t=>{
  const store=createJsonNaacStore(await fixture(t));
  assert.equal(allowedNaacOrigin(ORIGIN,ENV),true);
  for(const origin of ['', 'null','http://127.0.0.1:8787.evil.example','https://127.0.0.1:8787','https://untrusted.example'])assert.equal(allowedNaacOrigin(origin,ENV),false);
  assert.equal(allowedNaacOrigin('https://example.org',{NAAC_ALLOWED_ORIGINS:'*'}),false);
  assert.equal((await handleNaacRequest(request('/publish',snapshot(),TOKEN_A,'https://untrusted.example'),ENV,{store})).status,403);
  const response=await handleNaacRequest(request('/summary',null,'','https://untrusted.example'),ENV,{store});
  assert.equal(response.status,200);assert.equal(response.headers.get('Access-Control-Allow-Origin'),'*');
});
test('publishing preflight allows Authorization only for exact configured origins',async()=>{
  const allowed=await handleNaacRequest(new Request('https://report.example/api/naac/publish',{method:'OPTIONS',headers:{Origin:ORIGIN}}),ENV);
  assert.equal(allowed.status,204);assert.match(allowed.headers.get('Access-Control-Allow-Headers'),/Authorization/);
  assert.equal(allowed.headers.get('Access-Control-Allow-Origin'),ORIGIN);assert.equal(allowed.headers.get('Vary'),'Origin');
  const denied=await handleNaacRequest(new Request('https://report.example/api/naac/publish',{method:'OPTIONS',headers:{Origin:'https://evil.example'}}),ENV);
  assert.equal(denied.status,403);assert.equal(denied.headers.get('Access-Control-Allow-Origin'),null);
});
test('installation bearer format is strict and rejection never echoes the token',async t=>{
  const store=createJsonNaacStore(await fixture(t));
  for(const token of ['',TOKEN_A.toUpperCase(),'a'.repeat(47),'token='+TOKEN_A]){
    const response=await send(store,snapshot(),token);assert.equal(response.status,401);assert.ok(!(await response.text()).includes(TOKEN_A));
  }
});
test('JSON, streamed body limit and invalid shape are rejected before storage',async()=>{
  let calls=0;const store={replacePublisher(){calls++;}};
  for(const [type,body,status]of [['text/plain','{}',415],['application/json','not json',400],['application/json',' '.repeat(NAAC_BODY_LIMIT+1),413],['application/json',JSON.stringify({image:'private'}),400]]){
    const response=await handleNaacRequest(new Request('https://report.example/api/naac/publish',{method:'POST',headers:{Origin:ORIGIN,'Content-Type':type,Authorization:`Bearer ${TOKEN_A}`},body}),ENV,{store,now:NOW});assert.equal(response.status,status);
  }
  assert.equal(calls,0);
});
test('two clients share institution totals, repeats replace snapshots, restart preserves them',async t=>{
  const root=await fixture(t),store=createJsonNaacStore(root);
  assert.equal((await send(store)).status,200);
  assert.equal((await send(store,snapshot([row(0,4)]),TOKEN_B,'other-client')).status,200);
  assert.equal((await send(store)).status,200);
  let publicReport=await summary(store);assert.equal(publicReport.institutions[0].estimatedKg,6);assert.equal(publicReport.institutions[0].contributingProfiles,2);
  assert.equal((await send(store,snapshot([row(0,3)],2))).status,200);
  publicReport=await summary(createJsonNaacStore(root));assert.equal(publicReport.institutions[0].estimatedKg,7);assert.equal(publicReport.institutions.length,INSTITUTIONS.length);
});
test('empty snapshot revokes only that installation totals without deleting another client',async t=>{
  const store=createJsonNaacStore(await fixture(t));await send(store);await send(store,snapshot([row(0,4)]),TOKEN_B,'other-client');
  assert.equal((await send(store,snapshot([],2))).status,200);const report=await summary(store);
  assert.equal(report.institutions[0].estimatedKg,4);assert.equal(report.institutions[0].contributingProfiles,1);
});
test('private store persists only hashes and public responses include no installation identifiers',async t=>{
  const root=await fixture(t),store=createJsonNaacStore(root);await send(store);
  const storage=await fs.readFile(path.join(root,'.ecolens','private-naac.json'),'utf8');assert.ok(storage.includes(await hashSecret(TOKEN_A)));assert.ok(!storage.includes(TOKEN_A));assert.ok(!storage.includes('test-client'));
  const report=await summary(store),serialized=JSON.stringify(report);
  for(const forbidden of [TOKEN_A,await hashSecret(TOKEN_A),'publisher','clientHash','quotas','student','photo','xp'])assert.ok(!serialized.includes(forbidden));
  const expected=['institutionId','name','type','area',...NAAC_FIELDS,'hasRecords'].sort();assert.deepEqual(Object.keys(report.institutions[0]).sort(),expected);
});
test('concurrent publishing respects persistent quotas and a rejection preserves last totals',async t=>{
  const root=await fixture(t),store=createJsonNaacStore(root),env={...ENV,NAAC_PUBLISHES_PER_MINUTE:'1'};
  const responses=await Promise.all([send(store,snapshot(),TOKEN_A,'client',env),send(store,snapshot([row(0,100)]),TOKEN_B,'client',env)]);
  assert.deepEqual(responses.map(response=>response.status),[200,429]);assert.equal(responses[1].headers.get('Retry-After'),'60');
  assert.equal((await send(createJsonNaacStore(root),snapshot([row(0,100)],2),TOKEN_A,'client',env)).status,429);
  assert.equal((await summary(store)).institutions[0].estimatedKg,2);
});
test('storage corruption fails closed rather than erasing reports or exposing file details',async t=>{
  const root=await fixture(t);await fs.mkdir(path.join(root,'.ecolens'));await fs.writeFile(path.join(root,'.ecolens','private-naac.json'),'private corrupted fixture');
  const response=await handleNaacRequest(request('/summary'),ENV,{store:createJsonNaacStore(root)});assert.equal(response.status,503);assert.ok(!(await response.text()).includes(root));
});
test('D1 schema atomically replaces two clients, retries, revocations and rejects quota overflow',{skip:!DatabaseSync},async t=>{
  const {store,sqlite}=await schema(t);await send(store);await send(store,snapshot([row(0,4)]),TOKEN_B,'other-client');await send(store);
  assert.equal((await summary(store)).institutions[0].estimatedKg,6);
  const limited={...ENV,NAAC_PUBLISHES_PER_MINUTE:'2'};assert.equal((await send(store,snapshot([row(0,100)],2),TOKEN_A,'test-client',limited)).status,200);
  assert.equal((await send(store,snapshot([row(0,500)],3),TOKEN_A,'test-client',limited)).status,429);
  assert.equal((await summary(store)).institutions[0].estimatedKg,104);
  assert.equal(sqlite.prepare('SELECT requests FROM naac_write_quota WHERE bucket_key LIKE ?').get('minute:%test-client%'),undefined);
  assert.equal((await send(store,snapshot([],2),TOKEN_B,'other-client')).status,200);assert.equal((await summary(store)).institutions[0].estimatedKg,100);
});
test('D1 failed transaction leaves previous report intact and public errors are sanitized',{skip:!DatabaseSync},async t=>{
  const {store,sqlite}=await schema(t);await send(store);
  sqlite.exec("CREATE TRIGGER fail_changed_total BEFORE INSERT ON naac_institution_totals WHEN NEW.estimated_kg=99 BEGIN SELECT RAISE(ABORT,'private database failure'); END;");
  const response=await send(store,snapshot([row(0,99)],2));assert.equal(response.status,503);assert.ok(!(await response.text()).includes('private database failure'));
  assert.equal((await summary(store)).institutions[0].estimatedKg,2);
});
for(const adapter of ['JSON','D1'])test(`${adapter} stale and same-revision writes cannot overwrite newer totals or revive a revoked installation`,{skip:adapter==='D1'&&!DatabaseSync},async t=>{
  const store=adapter==='JSON'?createJsonNaacStore(await fixture(t)):(await schema(t)).store;
  assert.equal((await send(store,snapshot([row(0,6)],2))).status,200);
  assert.equal((await send(store,snapshot([row(0,99)],2))).status,200);
  assert.equal((await send(store,snapshot([row(0,99)],1))).status,200);
  assert.equal((await summary(store)).institutions[0].estimatedKg,6);
  assert.equal((await send(store,snapshot([],3))).status,200);
  assert.equal((await send(store,snapshot([row(0,99)],2))).status,200);
  const result=await summary(store);assert.equal(result.institutions[0].estimatedKg,0);assert.equal(result.institutions[0].hasRecords,false);
  assert.ok(!JSON.stringify(result).includes('revision'));
});
for(const adapter of ['JSON','D1'])test(`${adapter} replays do not exhaust quota and daily/IP/global limits reset on a later day`,{skip:adapter==='D1'&&!DatabaseSync},async t=>{
  const store=adapter==='JSON'?createJsonNaacStore(await fixture(t)):(await schema(t)).store;
  const env={...ENV,NAAC_PUBLISHES_PER_MINUTE:'1',NAAC_PUBLISHES_PER_IP_DAY:'1',NAAC_PUBLISHES_PER_DAY:'1'};
  assert.equal((await send(store,snapshot(),TOKEN_A,'client',env)).status,200);
  assert.equal((await send(store,snapshot(),TOKEN_A,'client',env)).status,200);
  assert.equal((await send(store,snapshot([row(0,9)],2),TOKEN_A,'client',env)).status,429);
  assert.equal((await send(store,snapshot([row(0,9)]),TOKEN_B,'other-client',env)).status,429);
  const nextDay=await handleNaacRequest(request('/publish',snapshot([row(0,5)],2)),env,{store,client:'client',now:()=>new Date('2026-10-14T06:00:00Z')});
  assert.equal(nextDay.status,200);assert.equal((await summary(store)).institutions[0].estimatedKg,5);
});
test('local server mounts NAAC routes before the vision API and keeps private files hidden',async t=>{
  const rootDir=await fixture(t);await fs.mkdir(path.join(rootDir,'naac'));await fs.writeFile(path.join(rootDir,'naac','index.html'),'<h1>Public institution report</h1>');
  const server=createEcolensServer({rootDir,env:ENV});
  assert.equal((await nodeRequest(server,{url:'/naac'})).status,308);
  assert.match((await nodeRequest(server,{url:'/naac/'})).body,/Public institution/);
  const headers={origin:ORIGIN,'content-type':'application/json',authorization:`Bearer ${TOKEN_A}`};
  assert.equal((await nodeRequest(server,{url:'/api/naac/publish',method:'POST',headers,body:JSON.stringify(snapshot())})).status,200);
  const result=await nodeRequest(server,{url:'/api/naac/summary',headers:{origin:'https://other.example'}});assert.equal(result.status,200);assert.equal(JSON.parse(result.body).institutions[0].estimatedKg,2);assert.equal(result.headers['access-control-allow-origin'],'*');
  assert.equal((await nodeRequest(server,{url:'/.ecolens/private-naac.json'})).status,404);
  assert.equal((await nodeRequest(server,{url:'/api/analyze',method:'POST',headers,body:'{}'})).status,503);
});
test('dedicated Worker uses only report assets and never enables the vision or private app API',{skip:!DatabaseSync},async t=>{
  const {database}=await schema(t);const assets=[];const env={...ENV,NAAC_DB:database,ASSETS:{fetch:async request=>{assets.push(new URL(request.url).pathname);return new Response('public asset');}}};
  const published=await worker.fetch(request(),env);assert.equal(published.status,200);
  const read=await worker.fetch(request('/summary',null,'','https://any.example'),env);assert.equal(read.status,200);assert.equal((await read.json()).institutions[0].estimatedKg,2);
  assert.equal((await worker.fetch(new Request('https://report.example/',{method:'GET'}),env)).status,200);assert.deepEqual(assets,['/']);
  const denied=await worker.fetch(new Request('https://report.example/api/analyze',{method:'POST',body:'private image'}),env);assert.equal(denied.status,405);assert.deepEqual(assets,['/']);
});
