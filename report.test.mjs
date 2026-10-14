import test from 'node:test';
import assert from 'node:assert/strict';
import {contributionsCSV, institutionReportDirectory, institutionSummaryCSV} from './report.js';
import {INSTITUTIONS} from './data.js';
import {loadAppState, addProfile, completeQuest, campusStats} from './core.js';
import {captureGeometry} from './media.js';
import {runScan} from './scan-flow.js';
test('contribution export keeps institution/student attribution and protects spreadsheet cells',()=>{
 const csv=contributionsCSV([{name:'=HYPERLINK("x")',institutionId:'uni',quests:2,items:3,estimatedKg:.5,estimatedCo2Kg:.2,reportedDivertedKg:.3,assumedDivertedKg:.2,eventXP:40}],{institutionName:()=> 'College, Kolkata',generatedAt:'2026-10-12T00:00:00Z'});
 assert.ok(csv.startsWith('\ufeff'));assert.match(csv,/"College, Kolkata"/);assert.match(csv,/"'=HYPERLINK\(""x""\)"/);assert.match(csv,/"0.5000","0.2000","0.3000","0.2000","40"/);assert.match(csv,/"this browser","self-reported"/);
});
test('mixed-scene capture includes the full landscape and portrait frame',()=>{
 assert.deepEqual(captureGeometry(1280,720,{scene:'group'}),{x:0,y:0,w:1280,h:720,width:960,height:540});
 assert.deepEqual(captureGeometry(720,1280,{scene:'group'}),{x:0,y:0,w:720,h:1280,width:540,height:960});
 const single=captureGeometry(1280,720);assert.ok(single.x>0&&single.y>0);assert.equal(single.width,640);assert.equal(single.w,single.h);
});
test('mixed-scene choice reaches both local and cloud engines',async()=>{
 const scenes=[];await runScan({}, {scene:'group',mode:'online',consent:true,localAnalyze:async(c,{scene})=>{scenes.push(['local',scene]);return {source:'offline',components:[]};},cloudAnalyze:async(c,{scene})=>{scenes.push(['cloud',scene]);return {source:'online',components:[]};}});
 assert.deepEqual(scenes,[['local','group'],['cloud','group']]);
});

const blankState = () => loadAppState({getItem:()=>null});
const now = new Date('2026-10-13T12:00:00Z');
function record(state, profile, id, route, weightGrams) {
 return completeQuest(state, {id, profileId:profile.id, kind:'sort', source:'manual', timestamp:now.toISOString(), components:[{name:'User confirmed item', material:route==='organic'?'organic':'paper', route, confidence:1, confirmedByUser:true}], ...(weightGrams === undefined ? {} : {weightGrams})});
}

test('the complete report directory lists universities, colleges and schools with no profile or activity',()=>{
 const state = blankState();
 const before = JSON.stringify(state);
 const rows = institutionReportDirectory(state, INSTITUTIONS, now);
 assert.equal(rows.length, INSTITUTIONS.length);
 assert.equal(rows.length,34);
 assert.deepEqual(rows.map(row=>row.institutionId), INSTITUTIONS.map(row=>row.id));
 assert.deepEqual(new Set(rows.map(row=>row.type)),new Set(['university','college','school']));
 for (const row of rows) {
  assert.equal(row.hasRecords,false);assert.equal(row.recordStatus,'no-local-records');
  assert.equal(row.estimatedKg,0);assert.equal(row.estimatedCo2Kg,0);assert.equal(row.quests,0);
  assert.equal(row.students,0);assert.equal(row.items,0);assert.equal(row.eventXP,0);
  assert.equal(row.scope,'this-device');assert.deepEqual(row.contributions,[]);
 }
 assert.equal(JSON.stringify(state),before);
});

test('reports use the same college and student ledger totals independently of the active profile',()=>{
 const state = blankState();
 const alice = addProfile(state,{name:'Alice',institutionId:'brainware'});
 const bob = addProfile(state,{name:'Bob',institutionId:'brainware'});
 const carol = addProfile(state,{name:'Carol',institutionId:'jadavpur'});
 record(state,alice,'alice-paper','recycle',500);
 record(state,bob,'bob-organic','organic',100);
 record(state,bob,'bob-residual','residual',300);
 record(state,carol,'carol-paper','recycle');
 state.activeProfileId=carol.id;
 const rows = institutionReportDirectory(state,INSTITUTIONS,now);
 const campus=rows.find(row=>row.institutionId==='brainware');
 const expected=campusStats(state,'brainware',now);
 assert.equal(campus.estimatedKg,.6);assert.ok(Math.abs(campus.recordedKg-.9)<1e-12);
 assert.equal(campus.estimatedKg,expected.estimatedKg);assert.equal(campus.estimatedCo2Kg,expected.estimatedCo2Kg);
 assert.equal(campus.reportedDivertedKg,.6);assert.equal(campus.assumedDivertedKg,0);
 assert.equal(campus.students,2);assert.equal(campus.contributingStudents,2);
 assert.equal(campus.quests,3);assert.equal(campus.eventXP,60);
 assert.equal(campus.hasRecords,true);
 assert.deepEqual(campus.contributions.map(row=>[row.name,row.estimatedKg,row.quests]),[['Alice',.5,1],['Bob',.1,2]]);
 state.activeProfileId=alice.id;
 assert.deepEqual(institutionReportDirectory(state,INSTITUTIONS,now),rows);
 assert.equal(rows.find(row=>row.institutionId==='jadavpur').assumedDivertedKg,.025);
});

test('custom institutions merge normalized names across IDs and catalog identities stay unique',()=>{
 const state=blankState();
 const first=addProfile(state,{name:'One',institutionId:'other',customInstitution:'  North   Campus '});
 const second=addProfile(state,{name:'Two',institutionId:'import-campus-7',customInstitution:'NORTH CAMPUS'});
 const known=addProfile(state,{name:'Three',institutionId:'brainware',customInstitution:'An ignored duplicate label'});
 const knownName=addProfile(state,{name:'Four',institutionId:'other',customInstitution:'BRAINWARE UNIVERSITY'});
 addProfile(state,{name:'Imported student',institutionId:'unlisted-campus-id'});
 record(state,first,'first','recycle',100);record(state,second,'second','organic',200);
 record(state,known,'known','recycle',300);record(state,knownName,'known-name','organic',400);
 const rows=institutionReportDirectory(state,[...INSTITUTIONS,INSTITUTIONS[0]],now);
 assert.equal(rows.length,INSTITUTIONS.length+2);
 const custom=rows.find(row=>row.name==='North Campus');
 assert.equal(custom.students,2);assert.equal(custom.quests,2);
 assert.ok(Math.abs(custom.estimatedKg-.3)<1e-12);
 assert.equal(custom.type,'custom');assert.equal(custom.customInstitution,'North Campus');
 assert.deepEqual(custom.contributions.map(row=>row.name),['Two','One']);
 const catalog=rows.filter(row=>row.institutionId==='brainware');
 assert.equal(catalog.length,1);assert.equal(catalog[0].students,2);assert.equal(catalog[0].estimatedKg,.7);
 assert.equal(rows.filter(row=>row.name==='unlisted-campus-id').length,1);
 assert.equal(rows.find(row=>row.name==='unlisted-campus-id').hasRecords,false);
 assert.equal(first.customInstitution,'North   Campus');
 assert.equal(second.institutionId,'import-campus-7');
});

test('summary CSV includes every institution and labels empty local records rather than measured university totals',()=>{
 const state=blankState();
 const profile=addProfile(state,{name:'Student',institutionId:'other',customInstitution:'=HYPERLINK("x")'});
 record(state,profile,'custom','recycle',100);
 const rows=institutionReportDirectory(state,INSTITUTIONS,now);
 const csv=institutionSummaryCSV(rows,{generatedAt:now.toISOString()});
 assert.equal(csv.split('\r\n').length,INSTITUTIONS.length+2);
 assert.ok(csv.startsWith('\ufeff'));
 assert.match(csv,/"Brainware University","university"/);
 assert.match(csv,/"No records in this browser","this browser","self-reported; estimates are not verified university totals"/);
 assert.match(csv,/"'=HYPERLINK\(""x""\)"/);
 assert.match(csv,/"Local activity recorded"/);
 assert.match(csv,/"0.1000"/);
});
