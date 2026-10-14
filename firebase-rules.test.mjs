import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INSTITUTIONS } from './data.js';
import { generateFirebaseNaacNamespace, mergeFirebaseNaacRules, FIREBASE_TOTAL_FIELDS, FIREBASE_NAAC_NAMESPACE } from './generate-firebase-rules.mjs';

const ROOT=path.dirname(fileURLToPath(import.meta.url));
test('Firebase rules generated files match the catalogue and expose only a mergeable NAAC namespace',async()=>{
  const expected=generateFirebaseNaacNamespace();
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(ROOT,'firebase.naac.rules.json'),'utf8')),expected);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(ROOT,'firebase.database.rules.json'),'utf8')),{rules:{'.read':false,'.write':false,...expected}});
  assert.deepEqual(Object.keys(expected),['ecolensNaacV1']);
  const rules=expected.ecolensNaacV1;assert.equal(rules['.read'],false);assert.equal(rules['.write'],false);assert.equal(rules.publicInstitutions['.read'],true);
  for(const row of INSTITUTIONS)assert.ok(rules.publicInstitutions.$institution['.validate'].includes(`$institution === '${row.id}'`));
  assert.equal(rules.publicInstitutions.$institution.$other['.validate'],false);assert.equal(rules.contributions.$uid.$institution.$other['.validate'],false);
  assert.ok(!JSON.stringify(expected).includes('studentName'));assert.ok(!JSON.stringify(expected).includes('estimatedKg'));
});
test('rules generator refuses unsafe or empty institution catalogues',()=>{
  for(const id of ['bad/path','bad.key','$special',"bad'quote",''])assert.throws(()=>generateFirebaseNaacNamespace([{id}]));
  assert.throws(()=>generateFirebaseNaacNamespace([]));
});
test('namespace merge preserves unrelated rules and rejects ancestor grants that defeat privacy',()=>{
  const original={rules:{'.read':false,'.write':'false',otherApp:{'.read':'auth.uid === $uid'}}};
  const merged=mergeFirebaseNaacRules(original);assert.deepEqual(merged.rules.otherApp,original.rules.otherApp);assert.ok(!Object.hasOwn(original.rules,'ecolensNaacV1'));
  for(const key of ['.read','.write'])for(const value of [true,'true','auth !== null','now < 9999999999999'])assert.throws(()=>mergeFirebaseNaacRules({rules:{[key]:value}}),/root access/);
});

const EMULATOR=Boolean(process.env.FIREBASE_DATABASE_EMULATOR_HOST&&process.env.FIREBASE_AUTH_EMULATOR_HOST);
test('actual RTDB emulator enforces cross-path atomic totals, ownership, schema, revisions and public-only reads',{skip:!EMULATOR},async t=>{
  const databaseHost=process.env.FIREBASE_DATABASE_EMULATOR_HOST,authHost=process.env.FIREBASE_AUTH_EMULATOR_HOST;
  assert.match(databaseHost,/^(?:127\.0\.0\.1|localhost):\d+$/);assert.match(authHost,/^(?:127\.0\.0\.1|localhost):\d+$/);
  const ns=process.env.GCLOUD_PROJECT||'demo-ecolens';assert.equal(ns,'demo-ecolens');
  // Install into this exact demo namespace: the CLI can select a different
  // default-rtdb instance. Emulator owner setup is forbidden for remote hosts.
  const rules=JSON.parse(await fs.readFile(path.join(ROOT,'firebase.database.rules.json'),'utf8'));
  const rulesUrl=`http://${databaseHost}/.settings/rules.json?ns=${ns}`;
  const setup=await fetch(rulesUrl,{method:'PUT',headers:{Authorization:'Bearer owner','Content-Type':'application/json'},body:JSON.stringify(rules)});
  assert.equal(setup.status,200,await setup.text());
  const installed=await fetch(rulesUrl,{headers:{Authorization:'Bearer owner'}});assert.equal(installed.status,200);assert.deepEqual(await installed.json(),rules);
  const reset=await fetch(`http://${databaseHost}/.json?ns=${ns}`,{method:'DELETE',headers:{Authorization:'Bearer owner'}});assert.equal(reset.status,200,await reset.text());
  async function auth(){const response=await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulator-only`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({returnSecureToken:true})});assert.equal(response.status,200);return response.json();}
  const [a,b]=await Promise.all([auth(),auth()]);assert.notEqual(a.localId,b.localId);
  async function api(relative='',{token,method='GET',body}={}){
    const url=new URL(`http://${databaseHost}/${relative}.json`);url.searchParams.set('ns',ns);if(token)url.searchParams.set('auth',token);
    const response=await fetch(url,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}return {status:response.status,data};
  }
  const own=(uid,id)=>`${FIREBASE_NAAC_NAMESPACE}/contributions/${uid}/${id}`;
  const publisher=uid=>`${FIREBASE_NAAC_NAMESPACE}/publishers/${uid}`;
  const pub=id=>`${FIREBASE_NAAC_NAMESPACE}/publicInstitutions/${id}`;
  const id=INSTITUTIONS[0].id,id2=INSTITUTIONS[1].id;
  const zeros=Object.fromEntries(FIREBASE_TOTAL_FIELDS.map(field=>[field,0]));
  const values=(mass=2)=>({...zeros,contributingProfiles:1,completedQuests:2,itemsHandled:3,estimatedMicroKg:mass*1e6,estimatedCo2MicroKg:mass*1.5e6,reportedDivertedMicroKg:mass*.75e6,assumedDivertedMicroKg:mass*.25e6});
  const stamp=()=>({'.sv':'timestamp'});
  function patch(user,institution,publicValues,ownValues,revision){return {[pub(institution)]:{...publicValues,updatedAt:stamp()},[own(user.localId,institution)]:{...ownValues,revision,updatedAt:stamp()},[publisher(user.localId)]:{revision,updatedAt:stamp()}};}
  const rootPatch=(user,body)=>api('',{token:user?.idToken,method:'PATCH',body});
  const allowed=async response=>assert.equal((await response).status,200,JSON.stringify((await response).data));
  const denied=async response=>{const result=await response;assert.ok([401,403].includes(result.status),JSON.stringify(result));};
  await t.test('anonymous public directory read works while database root and contributions stay private',async()=>{
    await allowed(api(`${FIREBASE_NAAC_NAMESPACE}/publicInstitutions`));
    await denied(api());await denied(api(FIREBASE_NAAC_NAMESPACE));await denied(api(`${FIREBASE_NAAC_NAMESPACE}/contributions`));
    await denied(api(`${FIREBASE_NAAC_NAMESPACE}/contributions/${a.localId}`));
    await allowed(api(`${FIREBASE_NAAC_NAMESPACE}/contributions/${a.localId}`,{token:a.idToken}));
    await denied(api(`${FIREBASE_NAAC_NAMESPACE}/contributions/${a.localId}`,{token:b.idToken}));
    await denied(api(`${FIREBASE_NAAC_NAMESPACE}/publishers`));await denied(api(publisher(a.localId),{token:b.idToken}));
    await allowed(api(publisher(a.localId),{token:a.idToken}));
  });
  await t.test('unauthenticated writes, standalone aggregate and standalone contribution are rejected',async()=>{
    await denied(rootPatch(null,patch(a,id,values(),values(),1)));
    await denied(api(pub(id),{token:a.idToken,method:'PUT',body:{...values(),updatedAt:stamp()}}));
    await denied(api(own(a.localId,id),{token:a.idToken,method:'PUT',body:{...values(),revision:1,updatedAt:stamp()}}));
  });
  await t.test('atomic future sibling reads allow first valid root PATCH',async()=>{
    await allowed(rootPatch(a,patch(a,id,values(),values(),1)));
    const visible=(await api(pub(id))).data;assert.equal(visible.estimatedMicroKg,2e6);assert.equal(typeof visible.updatedAt,'number');assert.deepEqual(Object.keys(visible).sort(),[...FIREBASE_TOTAL_FIELDS,'updatedAt'].sort());
  });
  await t.test('other owner edit, extra private fields, unknown institutions and priorities are denied atomically',async()=>{
    await denied(rootPatch(b,patch(a,id,values(3),values(3),2)));
    const extra=patch(a,id,values(3),values(3),2);extra[own(a.localId,id)].studentName='private fixture';await denied(rootPatch(a,extra));
    const publicExtra=patch(a,id,values(3),values(3),2);publicExtra[pub(id)].xp=12;await denied(rootPatch(a,publicExtra));
    await denied(rootPatch(a,patch(a,'unknown-institution',values(3),values(3),2)));
    const priority=patch(a,id,values(3),values(3),2);priority[pub(id)].estimatedMicroKg={'.value':3e6,'.priority':'private'};await denied(rootPatch(a,priority));
    for(const target of [pub(id),own(a.localId,id),publisher(a.localId)]){
      const recordPriority=patch(a,id,values(3),values(3),2);recordPriority[target]['.priority']='private';await denied(rootPatch(a,recordPriority));
    }
    assert.equal((await api(pub(id))).data.estimatedMicroKg,2e6);
  });
  await t.test('negative/fractional/excessive totals, string numbers, inconsistent sums and untrusted timestamps are denied',async()=>{
    for(const changed of [{itemsHandled:-1},{itemsHandled:1.5},{contributingProfiles:1001},{estimatedMicroKg:1e12+1},{itemsHandled:'3'},{estimatedMicroKg:3e6+1},{updatedAt:1}]){
      const body=patch(a,id,values(3),values(3),2);Object.assign(body[own(a.localId,id)],changed);await denied(rootPatch(a,body));
    }
    assert.equal((await api(pub(id))).data.estimatedMicroKg,2e6);
  });
  await t.test('second client adds only its own totals; stale public baselines reject then refreshed retry succeeds',async()=>{
    const added=Object.fromEntries(FIREBASE_TOTAL_FIELDS.map(field=>[field,values()[field]+values(4)[field]]));
    await denied(rootPatch(b,patch(b,id,values(4),values(4),1)));
    await allowed(rootPatch(b,patch(b,id,added,values(4),1)));
    assert.equal((await api(pub(id))).data.estimatedMicroKg,6e6);
    const changed=Object.fromEntries(FIREBASE_TOTAL_FIELDS.map(field=>[field,added[field]+values(3)[field]-values()[field]]));
    await allowed(rootPatch(a,patch(a,id,changed,values(3),2)));
    assert.equal((await api(pub(id))).data.estimatedMicroKg,7e6);
  });
  await t.test('replayed revision, old revision, contribution deletion and aggregate deletion are denied',async()=>{
    const current=(await api(pub(id))).data;delete current.updatedAt;
    await denied(rootPatch(a,patch(a,id,current,values(3),2)));
    await denied(rootPatch(a,patch(a,id,current,values(3),1)));
    await denied(rootPatch(a,{[own(a.localId,id)]:null,[pub(id)]:{...values(4),updatedAt:stamp()}}));
    await denied(api(pub(id),{token:a.idToken,method:'DELETE'}));
    await denied(api(`${FIREBASE_NAAC_NAMESPACE}/contributions/${a.localId}`,{token:a.idToken,method:'DELETE'}));
    await denied(api(publisher(a.localId),{token:a.idToken,method:'DELETE'}));
    // Updating public totals after an accepted publish still requires a new
    // owned contribution and publisher revision in the same atomic operation.
    await denied(api(pub(id),{token:a.idToken,method:'PUT',body:{...values(8),updatedAt:stamp()}}));
    await denied(rootPatch(a,{[publisher(a.localId)]:{revision:3,updatedAt:stamp()}}));
  });
  await t.test('higher revision zero tombstone revokes only its owner and late writes cannot restore it',async()=>{
    await allowed(rootPatch(a,patch(a,id,values(4),zeros,3)));
    assert.equal((await api(pub(id))).data.estimatedMicroKg,4e6);
    await denied(rootPatch(a,patch(a,id,values(7),values(3),2)));
    const owner=(await api(own(a.localId,id),{token:a.idToken})).data;assert.equal(owner.revision,3);assert.equal(owner.estimatedMicroKg,0);
    await allowed(rootPatch(b,patch(b,id,zeros,zeros,2)));
    assert.equal((await api(pub(id))).data.estimatedMicroKg,0);
  });
  await t.test('several institutions update atomically and one invalid path leaves all existing totals intact',async()=>{
    const body={...patch(a,id,values(1),values(1),4),...patch(a,id2,values(2),values(2),4)};
    await allowed(rootPatch(a,body));
    const invalid={...patch(a,id,values(2),values(2),5),...patch(a,id2,values(3),values(3),5)};invalid[pub(id2)].itemsHandled=999;
    await denied(rootPatch(a,invalid));assert.equal((await api(pub(id))).data.estimatedMicroKg,1e6);assert.equal((await api(pub(id2))).data.estimatedMicroKg,2e6);
    const publicRows=(await api(`${FIREBASE_NAAC_NAMESPACE}/publicInstitutions`)).data;const json=JSON.stringify(publicRows);for(const privateValue of [a.localId,b.localId,'revision','studentName','xp'])assert.ok(!json.includes(privateValue));
  });
  await t.test('global publisher tombstone blocks a delayed request introducing an unseen institution',async()=>{
    const c=await auth(),newId=INSTITUTIONS[3].id;
    await allowed(rootPatch(c,{[publisher(c.localId)]:{revision:2,updatedAt:stamp()}}));
    await denied(rootPatch(c,patch(c,newId,values(2),values(2),1)));
    assert.equal((await api(pub(newId))).data,null);
    await allowed(rootPatch(c,patch(c,newId,values(2),values(2),3)));
    await denied(rootPatch(c,{[publisher(c.localId)]:{revision:4,updatedAt:stamp()}}));
    assert.equal((await api(pub(newId))).data.estimatedMicroKg,2e6);
  });
  await t.test('real Firebase publish transport and anonymous Auth round trip obey the rules and revoke safely',async()=>{
    const {createFirebasePublishTransport}=await import('./firebase-sync.js');
    const configuration={version:1,provider:'firebase',projectId:'demo-ecolens',apiKey:'AIza'+'A'.repeat(35),databaseURL:'https://demo-ecolens-default-rtdb.firebaseio.com'};
    const memory=()=>{const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value))};};
    const routeEmulator=async(input,options)=>{
      const url=new URL(input);
      if(url.hostname==='demo-ecolens.web.app'&&url.pathname==='/firebase-config.json')return Response.json(configuration);
      if(['identitytoolkit.googleapis.com','securetoken.googleapis.com'].includes(url.hostname))return fetch(`http://${authHost}/${url.hostname}${url.pathname}${url.search}`,options);
      if(url.hostname==='demo-ecolens-default-rtdb.firebaseio.com'){const target=new URL(`http://${databaseHost}${url.pathname}${url.search}`);target.searchParams.set('ns',ns);return fetch(target,options);}
      throw new Error('An emulator test attempted to contact a remote service.');
    };
    const transportA=createFirebasePublishTransport({storage:memory(),fetchImpl:routeEmulator}),transportB=createFirebasePublishTransport({storage:memory(),fetchImpl:routeEmulator});
    const institutionId=INSTITUTIONS[2].id,endpoint='https://demo-ecolens.web.app';
    const snapshot=(kg,revision)=>({version:1,revision,institutions:kg?[{institutionId,contributingProfiles:1,completedQuests:1,itemsHandled:1,estimatedKg:kg,estimatedCo2Kg:kg*2,reportedDivertedKg:kg,assumedDivertedKg:0}]:[]});
    assert.equal((await transportA({endpoint,snapshot:snapshot(2,1)})).published,true);
    assert.equal((await transportB({endpoint,snapshot:snapshot(4,1)})).published,true);
    assert.equal((await api(pub(institutionId))).data.estimatedMicroKg,6e6);
    assert.equal((await transportA({endpoint,snapshot:snapshot(3,2)})).published,true);
    assert.equal((await api(pub(institutionId))).data.estimatedMicroKg,7e6);
    assert.equal((await transportA({endpoint,snapshot:snapshot(0,3),revoke:true})).published,true);
    assert.equal((await api(pub(institutionId))).data.estimatedMicroKg,4e6);
  });
});
