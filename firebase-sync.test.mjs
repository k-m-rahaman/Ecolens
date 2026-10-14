import test from 'node:test';
import assert from 'node:assert/strict';
import {createFirebasePublishTransport,validateFirebaseConfig,firebaseSnapshotRows,FIREBASE_AUTH_KEY_PREFIX,FIREBASE_TOTAL_FIELDS} from './firebase-sync.js';
import {loadAppState,exportState} from './core.js';
import {createPublicSync,PUBLIC_REVISION_KEY} from './public-sync.js';

const endpoint='https://ecolens-demo.web.app',projectId='ecolens-demo',initialNow=1_800_000_000_000;
const config={version:1,provider:'firebase',projectId,apiKey:'AIza'+'a'.repeat(35),databaseURL:'https://ecolens-demo-default-rtdb.asia-southeast1.firebasedatabase.app'};
const snapshot=(revision=1,institutions=[{institutionId:'brainware',contributingProfiles:2,completedQuests:3,itemsHandled:4,estimatedKg:.525,estimatedCo2Kg:.5575,reportedDivertedKg:.5,assumedDivertedKg:.025}])=>({version:1,revision,institutions});
const empty=(revision=2)=>snapshot(revision,[]);
const zero=()=>Object.fromEntries(FIREBASE_TOTAL_FIELDS.map(field=>[field,0]));
const totals=(overrides={})=>({...zero(),...overrides});
const copy=value=>JSON.parse(JSON.stringify(value));
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const code=expected=>error=>error.code===expected;
function storage(){const values=new Map();return{values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};}
function jwt(uid,{aud=projectId,nonce=0}={}){return `header.${Buffer.from(JSON.stringify({aud,sub:uid,iss:`https://securetoken.google.com/${aud}`,nonce})).toString('base64url')}.signature`;}
function uidFromToken(token){return JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString()).sub;}
function restFixture({denyPatches=false,collision=false}={}){
  const state={now:initialNow,public:{},own:{},publishers:{},calls:[],patches:[],signups:0,refreshes:0,collisionDone:false,failRefresh:false};
  const responseToken=uid=>({localId:uid,idToken:jwt(uid,{nonce:state.refreshes}),refreshToken:`refresh-${uid}`,expiresIn:'3600'});
  async function fetchImpl(url,options={}){
    const target=new URL(url);state.calls.push({url,options});
    assert.equal(options.credentials,'omit');assert.equal(options.referrerPolicy,'no-referrer');assert.equal(options.cache,'no-store');
    if(target.pathname==='/firebase-config.json')return json(config);
    if(target.hostname==='identitytoolkit.googleapis.com'){
      assert.equal(options.method,'POST');assert.deepEqual(JSON.parse(options.body),{returnSecureToken:true});
      state.signups++;return json(responseToken(`anonymous-publisher-${state.signups}`));
    }
    if(target.hostname==='securetoken.googleapis.com'){
      state.refreshes++;if(state.failRefresh)return json({error:{message:'TOKEN_EXPIRED'}},400);
      const form=new URLSearchParams(options.body);assert.equal(form.get('grant_type'),'refresh_token');
      const uid=form.get('refresh_token').slice('refresh-'.length);const reply=responseToken(uid);
      return json({id_token:reply.idToken,refresh_token:reply.refreshToken,expires_in:'3600',user_id:uid,project_id:'1234567890'});
    }
    assert.equal(target.origin,config.databaseURL);
    if(target.pathname==='/ecolensNaacV1/publicInstitutions.json'){assert.equal(target.search,'');return json(state.public);}
    if(target.pathname.startsWith('/ecolensNaacV1/contributions/')){
      const uid=target.pathname.split('/')[3].replace('.json','');assert.equal(uid,uidFromToken(target.searchParams.get('auth')));
      return json(state.own[uid]||null);
    }
    if(target.pathname.startsWith('/ecolensNaacV1/publishers/')){
      const uid=target.pathname.split('/')[3].replace('.json','');assert.equal(uid,uidFromToken(target.searchParams.get('auth')));return json(state.publishers[uid]||null);
    }
    assert.equal(target.pathname,'/ecolensNaacV1.json');assert.equal(options.method,'PATCH');
    const uid=uidFromToken(target.searchParams.get('auth')),patch=JSON.parse(options.body);state.patches.push(copy(patch));
    if(denyPatches)return json({error:'Permission denied'},403);
    const marker=patch[`publishers/${uid}`];assert.ok(marker);assert.deepEqual(Object.keys(marker),['revision','updatedAt']);assert.deepEqual(marker.updatedAt,{'.sv':'timestamp'});
    if(marker.revision<=(state.publishers[uid]?.revision||0))return json({error:'Permission denied'},403);
    if(collision&&!state.collisionDone){
      state.collisionDone=true;state.public.brainware={...totals({contributingProfiles:1,completedQuests:1,itemsHandled:1,estimatedMicroKg:100000,reportedDivertedMicroKg:100000,estimatedCo2MicroKg:110000}),updatedAt:state.now};
      return json({error:'Permission denied'},403);
    }
    const draftPublic=copy(state.public),draftOwn=copy(state.own),reply={[`publishers/${uid}`]:{...marker,updatedAt:state.now}};draftOwn[uid]||={};
    for(const id of Object.keys(state.own[uid]||{}))assert.equal(patch[`contributions/${uid}/${id}`]?.revision,marker.revision);
    for(const path of Object.keys(patch).filter(path=>path.startsWith('publicInstitutions/'))){
      const id=path.split('/')[1],ownPath=`contributions/${uid}/${id}`,own=patch[ownPath],aggregate=patch[path],old=state.own[uid]?.[id]||zero(),current=state.public[id]||zero();
      assert.ok(own);assert.deepEqual(Object.keys(aggregate),[...FIREBASE_TOTAL_FIELDS,'updatedAt']);assert.deepEqual(Object.keys(own),[...FIREBASE_TOTAL_FIELDS,'revision','updatedAt']);
      assert.ok(Number.isSafeInteger(own.revision)&&own.revision>(old.revision||0));
      assert.equal(own.revision,marker.revision);
      assert.deepEqual(own.updatedAt,{'.sv':'timestamp'});assert.deepEqual(aggregate.updatedAt,{'.sv':'timestamp'});
      for(const field of FIREBASE_TOTAL_FIELDS){assert.equal(aggregate[field],current[field]+own[field]-old[field]);assert.ok(Number.isSafeInteger(aggregate[field])&&aggregate[field]>=0);}
      assert.equal(aggregate.estimatedMicroKg,aggregate.reportedDivertedMicroKg+aggregate.assumedDivertedMicroKg);
      draftPublic[id]={...aggregate,updatedAt:state.now};draftOwn[uid][id]={...own,updatedAt:state.now};reply[path]=draftPublic[id];reply[ownPath]=draftOwn[uid][id];
    }
    state.public=draftPublic;state.own=draftOwn;state.publishers[uid]=reply[`publishers/${uid}`];return json(reply);
  }
  return {state,fetchImpl};
}
const transport=(fixture,store=storage(),extra={})=>createFirebasePublishTransport({storage:store,fetchImpl:fixture.fetchImpl,now:()=>fixture.state.now,...extra});

test('transport construction performs no network request and creates no anonymous account',()=>{
  let calls=0;const store=storage();createFirebasePublishTransport({storage:store,fetchImpl:()=>{calls++;}});assert.equal(calls,0);assert.equal(store.values.size,0);
});

test('Firebase configuration validates exact public fields and project-bound hosts',()=>{
  assert.deepEqual(validateFirebaseConfig(config,endpoint),config);
  for(const site of ['ecolens-demo-naac','ecolens-demo-naac-ab12','ecolens-demo-naac-a1b2c3d4'])assert.deepEqual(validateFirebaseConfig(config,`https://${site}.web.app`),config);
  for(const databaseURL of [`https://${projectId}.firebaseio.com`,`https://${projectId}-default-rtdb.firebaseio.com`,`https://${projectId}-default-rtdb.europe-west1.firebasedatabase.app`])assert.equal(validateFirebaseConfig({...config,databaseURL},`https://${projectId}.firebaseapp.com`).databaseURL,databaseURL);
  for(const invalid of [
    {...config,provider:'other'}, {...config,version:2}, {...config,privateKey:'admin-secret'}, {...config,apiKey:'service-account'},
    {...config,databaseURL:'http://ecolens-demo.firebaseio.com'}, {...config,databaseURL:'https://other-project-default-rtdb.asia-southeast1.firebasedatabase.app'},
    {...config,databaseURL:'https://ecolens-demo-default-rtdb.asia-southeast1.firebasedatabase.app.evil.example'}, {...config,databaseURL:`${config.databaseURL}/private`},
    {...config,databaseURL:`${config.databaseURL}/?auth=secret`}, {...config,databaseURL:'https://user:password@ecolens-demo.firebaseio.com'}
  ])assert.throws(()=>validateFirebaseConfig(invalid,endpoint),code('SHARING_DISABLED'));
  for(const address of ['http://ecolens-demo.web.app','https://ecolens-demo.web.app.evil.example','https://ecolens-demo.web.app/path','https://user:secret@ecolens-demo.web.app','https://ecolens-demo.web.app/?x=1'])assert.throws(()=>validateFirebaseConfig(config,address),code('INVALID_ENDPOINT'));
  assert.throws(()=>validateFirebaseConfig(config,'https://other-project.web.app'),code('SHARING_DISABLED'));
});

test('snapshot whitelist preserves counts and converts mass to exact integer microkg',()=>{
  assert.deepEqual([...firebaseSnapshotRows(snapshot()).entries()],[['brainware',{contributingProfiles:2,completedQuests:3,itemsHandled:4,estimatedMicroKg:525000,estimatedCo2MicroKg:557500,reportedDivertedMicroKg:500000,assumedDivertedMicroKg:25000}]]);
  for(const value of [{...snapshot(),name:'private'},snapshot(0),snapshot(1,[{...snapshot().institutions[0],name:'private'}]),snapshot(1,[{...snapshot().institutions[0],institutionId:'private-custom'}]),snapshot(1,[{...snapshot().institutions[0],itemsHandled:1.5}]),snapshot(1,[{...snapshot().institutions[0],estimatedKg:.6}])])assert.throws(()=>firebaseSnapshotRows(value),code('INVALID_SNAPSHOT'));
});

test('initial publication stores private anonymous auth and atomically publishes only aggregate rows',async()=>{
  const fixture=restFixture(),store=storage(),publish=transport(fixture,store);
  const reply=await publish({endpoint,snapshot:snapshot()});assert.deepEqual(reply,{version:1,published:true,updatedAt:new Date(initialNow).toISOString()});
  assert.equal(fixture.state.signups,1);assert.equal(fixture.state.patches.length,1);
  assert.deepEqual(Object.keys(fixture.state.patches[0]),['publishers/anonymous-publisher-1','publicInstitutions/brainware','contributions/anonymous-publisher-1/brainware']);
  assert.equal(fixture.state.public.brainware.estimatedMicroKg,525000);
  assert.equal([...store.values.keys()][0],`${FIREBASE_AUTH_KEY_PREFIX}${projectId}:${new URL(config.databaseURL).hostname}`);
  const auth=JSON.parse([...store.values.values()][0]);assert.equal(auth.uid,'anonymous-publisher-1');assert.ok(auth.refreshToken);assert.ok(auth.idToken);
  const publicBody=JSON.stringify(fixture.state.public);for(const text of ['anonymous-publisher','refresh-','idToken','uid','revision','name','photo','xp','history'])assert.equal(publicBody.includes(text),false,text);
});

test('an explicit empty opt-in retains its identity so turning sharing off remains safe',async()=>{
  const fixture=restFixture(),store=storage(),publish=transport(fixture,store);await publish({endpoint,snapshot:empty(1)});
  assert.equal(fixture.state.signups,1);assert.equal(fixture.state.patches.length,1);assert.equal(store.values.size,1);
  await publish({endpoint,snapshot:empty(2),revoke:true});assert.equal(fixture.state.signups,1);assert.equal(fixture.state.patches.length,2);assert.deepEqual(fixture.state.public,{});
  assert.equal(fixture.state.publishers['anonymous-publisher-1'].revision,2);
});

test('the same browser reuses its UID after reload and backups exclude all auth credentials',async()=>{
  const fixture=restFixture(),store=storage();await transport(fixture,store)({endpoint,snapshot:snapshot()});
  await transport(fixture,store)({endpoint,snapshot:snapshot(2)});assert.equal(fixture.state.signups,1);assert.equal(Object.keys(fixture.state.own).length,1);
  const backup=exportState(loadAppState({getItem:()=>null})),auth=JSON.parse([...store.values.values()][0]);
  for(const value of [auth.uid,auth.idToken,auth.refreshToken,FIREBASE_AUTH_KEY_PREFIX])assert.equal(backup.includes(value),false);
});

test('separate browsers use separate anonymous identities and their public totals sum',async()=>{
  const fixture=restFixture();await transport(fixture)({endpoint,snapshot:snapshot()});await transport(fixture)({endpoint,snapshot:snapshot()});
  assert.equal(fixture.state.signups,2);assert.equal(Object.keys(fixture.state.own).length,2);assert.equal(fixture.state.public.brainware.estimatedMicroKg,1050000);assert.equal(fixture.state.public.brainware.contributingProfiles,4);
});

test('same and older revisions are acknowledged without another write or double counting',async()=>{
  const fixture=restFixture(),publish=transport(fixture);await publish({endpoint,snapshot:snapshot(3)});
  await publish({endpoint,snapshot:snapshot(3)});await publish({endpoint,snapshot:snapshot(2)});
  assert.equal(fixture.state.patches.length,1);assert.equal(fixture.state.public.brainware.estimatedMicroKg,525000);
});

test('stale revoke retains pending removal and a later explicit retry uses a newer revision',async()=>{
  const fixture=restFixture(),store=storage(),publish=transport(fixture,store);
  const newerRevision=Math.max(Date.now(),initialNow)+1_000_000;
  await publish({endpoint,snapshot:snapshot(newerRevision)});
  store.setItem(PUBLIC_REVISION_KEY,'1');
  const sync=createPublicSync({storage:store,fetchImpl:fixture.fetchImpl,publishTransport:publish});
  await assert.rejects(sync.revoke({endpoint}),code('PUBLIC_RESPONSE'));
  assert.equal(fixture.state.patches.length,1);
  assert.equal(fixture.state.public.brainware.estimatedMicroKg,525000);
  assert.equal(fixture.state.publishers['anonymous-publisher-1'].revision,newerRevision);
  assert.equal(Number(store.getItem(PUBLIC_REVISION_KEY)),newerRevision);
  assert.deepEqual(sync.pendingRemovals(),[endpoint]);
  assert.equal((await sync.revoke({endpoint})).status,'revoked');
  assert.equal(fixture.state.patches.length,2);
  assert.equal(fixture.state.publishers['anonymous-publisher-1'].revision,newerRevision+1);
  assert.equal(fixture.state.public.brainware.estimatedMicroKg,0);
  assert.equal(fixture.state.own['anonymous-publisher-1'].brainware.estimatedMicroKg,0);
  assert.deepEqual(sync.pendingRemovals(),[]);
});

test('stale revoke cannot acknowledge count-only contributions and never lowers a saved revision',async()=>{
  const fixture=restFixture(),store=storage(),publish=transport(fixture,store);
  const countOnly={...snapshot().institutions[0],contributingProfiles:0,completedQuests:0,itemsHandled:1,estimatedKg:0,estimatedCo2Kg:0,reportedDivertedKg:0,assumedDivertedKg:0};
  await publish({endpoint,snapshot:snapshot(10,[countOnly])});
  store.setItem(PUBLIC_REVISION_KEY,'15');
  await assert.rejects(publish({endpoint,snapshot:empty(9),revoke:true}),code('PUBLIC_RESPONSE'));
  assert.equal(Number(store.getItem(PUBLIC_REVISION_KEY)),15);
  assert.equal(fixture.state.patches.length,1);
  assert.equal(fixture.state.public.brainware.itemsHandled,1);
});

test('stale revoke succeeds only after owned rows are verified as zero or absent',async()=>{
  for(const hadRecords of [false,true]){
    const fixture=restFixture(),publish=transport(fixture);
    await publish({endpoint,snapshot:hadRecords?snapshot(1):empty(1)});
    await publish({endpoint,snapshot:empty(3),revoke:true});
    const patchCount=fixture.state.patches.length;
    assert.equal((await publish({endpoint,snapshot:empty(2),revoke:true})).published,true);
    assert.equal(fixture.state.patches.length,patchCount);
    for(const row of Object.values(fixture.state.own['anonymous-publisher-1']||{}))for(const field of FIREBASE_TOTAL_FIELDS)assert.equal(row[field],0);
  }
});

test('stale revoke stops safely when the recovered revision cannot be saved',async()=>{
  const fixture=restFixture(),store=storage(),publish=transport(fixture,store);
  await publish({endpoint,snapshot:snapshot(10)});
  const setItem=store.setItem;
  store.setItem=(key,value)=>{if(key===PUBLIC_REVISION_KEY)throw new Error('private storage failure');return setItem(key,value);};
  await assert.rejects(publish({endpoint,snapshot:empty(9),revoke:true}),error=>error.code==='IDENTITY_UNAVAILABLE'&&!error.message.includes('private storage failure'));
  assert.equal(fixture.state.patches.length,1);
  assert.equal(fixture.state.public.brainware.estimatedMicroKg,525000);
});

test('latest snapshots replace the prior contribution and preserve other browsers totals',async()=>{
  const fixture=restFixture(),first=transport(fixture),second=transport(fixture);await first({endpoint,snapshot:snapshot()});await second({endpoint,snapshot:snapshot()});
  const changed=snapshot(2);changed.institutions[0].reportedDivertedKg=1;changed.institutions[0].estimatedKg=1.025;
  await first({endpoint,snapshot:changed});assert.equal(fixture.state.public.brainware.estimatedMicroKg,1550000);assert.equal(fixture.state.public.brainware.contributingProfiles,4);
});

test('removed institutions become zero tombstones and stale writes cannot restore revoked data',async()=>{
  const fixture=restFixture(),publish=transport(fixture);await publish({endpoint,snapshot:snapshot()});
  const moved=snapshot(2,[{...snapshot().institutions[0],institutionId:'jadavpur'}]);await publish({endpoint,snapshot:moved});
  assert.equal(fixture.state.public.brainware.estimatedMicroKg,0);assert.equal(fixture.state.public.jadavpur.estimatedMicroKg,525000);
  assert.equal(fixture.state.own['anonymous-publisher-1'].brainware.revision,2);assert.equal(fixture.state.own['anonymous-publisher-1'].brainware.estimatedMicroKg,0);
  await publish({endpoint,snapshot:empty(3),revoke:true});assert.equal(fixture.state.public.jadavpur.estimatedMicroKg,0);
  await publish({endpoint,snapshot:snapshot(2)});assert.equal(fixture.state.public.brainware.estimatedMicroKg,0);assert.equal(fixture.state.public.jadavpur.estimatedMicroKg,0);
  for(const patch of fixture.state.patches)assert.equal(Object.values(patch).some(row=>row===null),false);
});

test('a delayed older write cannot introduce an unseen institution after a newer empty revoke',async()=>{
  const fixture=restFixture(),store=storage();await transport(fixture,store)({endpoint,snapshot:empty(1)});
  let ready,release;
  const started=new Promise(resolve=>{ready=resolve;}),pause=new Promise(resolve=>{release=resolve;});
  const delayedFetch=async(url,options)=>{if(options.method==='PATCH'&&JSON.parse(options.body)['publishers/anonymous-publisher-1'].revision===2){ready();await pause;}return fixture.fetchImpl(url,options);};
  const delayed=createFirebasePublishTransport({storage:store,fetchImpl:delayedFetch,now:()=>fixture.state.now});
  const old=delayed({endpoint,snapshot:snapshot(2,[{...snapshot().institutions[0],institutionId:'jadavpur'}])});await started;
  await transport(fixture,store)({endpoint,snapshot:empty(3),revoke:true});release();await old;
  assert.equal(fixture.state.publishers['anonymous-publisher-1'].revision,3);assert.deepEqual(fixture.state.public,{});assert.deepEqual(fixture.state.own['anonymous-publisher-1'],{});
  assert.equal(fixture.state.signups,1);
});

test('revoking after losing identity stops and never creates a replacement anonymous UID',async()=>{
  const fixture=restFixture(),store=storage(),publish=transport(fixture,store);await publish({endpoint,snapshot:snapshot()});store.values.clear();
  await assert.rejects(publish({endpoint,snapshot:empty(2),revoke:true}),code('IDENTITY_UNAVAILABLE'));
  assert.equal(fixture.state.signups,1);assert.equal(fixture.state.public.brainware.estimatedMicroKg,525000);
});

test('expired tokens renew the same UID using securetoken REST and rotated credentials',async()=>{
  const fixture=restFixture(),store=storage(),publish=transport(fixture,store);await publish({endpoint,snapshot:snapshot()});
  const previous=JSON.parse([...store.values.values()][0]);fixture.state.now+=3600001;
  await publish({endpoint,snapshot:snapshot(2)});const renewed=JSON.parse([...store.values.values()][0]);
  assert.equal(fixture.state.signups,1);assert.equal(fixture.state.refreshes,1);assert.equal(renewed.uid,previous.uid);assert.notEqual(renewed.idToken,previous.idToken);assert.ok(renewed.expiresAt>previous.expiresAt);
});

test('a failed token refresh preserves the original identity and never silently signs up again',async()=>{
  const fixture=restFixture(),store=storage(),publish=transport(fixture,store);await publish({endpoint,snapshot:snapshot()});
  const saved=[...store.values.values()][0];fixture.state.now+=3600001;fixture.state.failRefresh=true;
  await assert.rejects(publish({endpoint,snapshot:snapshot(2)}));assert.equal(fixture.state.signups,1);assert.equal([...store.values.values()][0],saved);assert.equal(fixture.state.patches.length,1);
});

test('auth replies from a different project cannot reach the database or enter storage',async()=>{
  const fixture=restFixture(),store=storage();const fetchImpl=async(url,options)=>url.includes('identitytoolkit')?json({localId:'attacker',idToken:jwt('attacker',{aud:'other-project'}),refreshToken:'private-refresh',expiresIn:'3600'}):fixture.fetchImpl(url,options);
  await assert.rejects(createFirebasePublishTransport({storage:store,fetchImpl,now:()=>initialNow})({endpoint,snapshot:snapshot()}),code('INVALID_TOKEN'));
  assert.equal(store.values.size,0);assert.equal(fixture.state.patches.length,0);
});

test('rule collisions trigger a bounded reread and rebase without losing another contribution',async()=>{
  const fixture=restFixture({collision:true});await transport(fixture)({endpoint,snapshot:snapshot()});
  assert.equal(fixture.state.patches.length,2);assert.equal(fixture.state.public.brainware.estimatedMicroKg,625000);assert.equal(fixture.state.public.brainware.contributingProfiles,3);
});

test('persistent permission rejection is limited to three patch attempts',async()=>{
  const fixture=restFixture({denyPatches:true});await assert.rejects(transport(fixture)({endpoint,snapshot:snapshot()}));
  assert.equal(fixture.state.patches.length,3);assert.deepEqual(fixture.state.public,{});
});

test('abort during a hung read rejects promptly and no patch follows',async()=>{
  const fixture=restFixture(),controller=new AbortController();let ready;
  const started=new Promise(resolve=>{ready=resolve;});
  const fetchImpl=(url,options)=>{if(url.includes('/contributions/')){ready();return new Promise(()=>{});}return fixture.fetchImpl(url,options);};
  const publish=createFirebasePublishTransport({storage:storage(),fetchImpl,now:()=>initialNow});
  const pending=publish({endpoint,snapshot:snapshot(),signal:controller.signal});await started;controller.abort();
  await assert.rejects(pending,code('REQUEST_CANCELLED'));assert.equal(fixture.state.patches.length,0);
});

test('an already cancelled operation performs no config read or sign-up',async()=>{
  const fixture=restFixture(),controller=new AbortController();controller.abort();
  await assert.rejects(transport(fixture)({endpoint,snapshot:snapshot(),signal:controller.signal}),code('REQUEST_CANCELLED'));assert.equal(fixture.state.calls.length,0);
});

test('storage failures stop before a database write and raw remote error text stays hidden',async()=>{
  const fixture=restFixture();const store={getItem:()=>null,setItem:()=>{throw new Error('blocked');}};
  await assert.rejects(transport(fixture,store)({endpoint,snapshot:snapshot()}),code('IDENTITY_UNAVAILABLE'));assert.equal(fixture.state.patches.length,0);
  const fetchImpl=async()=>json({error:{message:'private-token-reflected'}},429);
  await assert.rejects(createFirebasePublishTransport({storage:storage(),fetchImpl})({endpoint,snapshot:snapshot()}),error=>error.code==='RATE_LIMIT'&&!error.message.includes('private-token'));
});
