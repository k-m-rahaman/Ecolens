import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicSync, PUBLIC_IDENTITY_KEY } from './public-sync.js';
import { loadAppState, addProfile, completeQuest, exportState } from './core.js';

test('Firebase transport is consent-gated and receives only aggregates, revisions and explicit revocation',async()=>{
 const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value))};
 const state=loadAppState({getItem:()=>null}),profile=addProfile(state,{name:'Private fixture student',institutionId:'brainware'});
 completeQuest(state,{id:'private-event',profileId:profile.id,kind:'sort',source:'manual',timestamp:'2026-10-13T12:00:00Z',components:[{name:'Private item',material:'paper',route:'recycle',confidence:1,confirmedByUser:true}],weightGrams:500});
 const calls=[],sync=createPublicSync({storage,cryptoImpl:null,publishTransport:async call=>{calls.push(call);return {version:1,published:true,updatedAt:'2026-10-13T12:00:00Z'};},fetchImpl:()=>{throw new Error('Legacy API must not receive Firebase data');}});
 assert.equal((await sync.sync(state,{endpoint:'https://ecolens-live-naac.web.app',enabled:false})).status,'disabled');assert.equal(calls.length,0);assert.equal(values.size,0);
 assert.equal((await sync.sync(state,{endpoint:'https://ecolens-live-naac.web.app',enabled:true})).status,'published');
 assert.deepEqual(Object.keys(calls[0]).sort(),['endpoint','revoke','signal','snapshot']);assert.equal(calls[0].revoke,false);assert.equal(calls[0].snapshot.institutions[0].estimatedKg,.5);
 assert.ok(!JSON.stringify(calls[0].snapshot).includes('Private'));assert.ok(!JSON.stringify(calls[0].snapshot).includes(profile.id));assert.equal(storage.getItem(PUBLIC_IDENTITY_KEY),null);
 const revision=calls[0].snapshot.revision;
 assert.equal((await sync.revoke({endpoint:'https://ecolens-live-naac.web.app'})).status,'revoked');
 assert.equal(calls[1].revoke,true);assert.deepEqual(calls[1].snapshot.institutions,[]);assert.ok(calls[1].snapshot.revision>revision);assert.deepEqual(sync.pendingRemovals(),[]);
 assert.ok(!exportState(state).includes('firebase-transport'));
});
