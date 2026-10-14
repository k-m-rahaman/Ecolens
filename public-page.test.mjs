import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {TEXT,METRIC_FIELDS,validateCatalog,validatePublicSummary,mergeCatalog,filterInstitutions,aggregateTotals,reportCSV,readPreferences,createPublicApp} from './naac/public.js';

const html=await readFile(new URL('./naac/index.html',import.meta.url),'utf8');
const source=await readFile(new URL('./naac/public.js',import.meta.url),'utf8');
const catalog=validateCatalog(JSON.parse(await readFile(new URL('./naac/catalog.json',import.meta.url),'utf8')));
function summary(){return {version:1,source:'shared',scope:'public-institution-aggregates',updatedAt:'2026-10-13T07:00:00.000Z',institutions:catalog.map((row,index)=>({...row,contributingProfiles:index===0?2:0,completedQuests:index===0?4:0,itemsHandled:index===0?6:0,estimatedKg:index===0?3:0,estimatedCo2Kg:index===0?1.5:0,reportedDivertedKg:index===0?2:0,assumedDivertedKg:index===0?1:0,hasRecords:index===0}))};}
const config={version:1,provider:'firebase',projectId:'ecolens-demo',apiKey:'AIza'+'a'.repeat(35),databaseURL:'https://ecolens-demo-default-rtdb.firebaseio.com'};
const publicURL=config.databaseURL+'/ecolensNaacV1/publicInstitutions.json';
function firebaseTotals(){return Object.fromEntries(summary().institutions.map(row=>[row.institutionId,{contributingProfiles:row.contributingProfiles,completedQuests:row.completedQuests,itemsHandled:row.itemsHandled,estimatedMicroKg:row.estimatedKg*1e6,estimatedCo2MicroKg:row.estimatedCo2Kg*1e6,reportedDivertedMicroKg:row.reportedDivertedKg*1e6,assumedDivertedMicroKg:row.assumedDivertedKg*1e6,updatedAt:Date.parse(summary().updatedAt)}]));}
class Node {
 constructor(tag='div'){this.tagName=tag;this.children=[];this.attributes={};this.dataset={};this.style={};this.listeners={};this.value='';this.hidden=false;this.disabled=false;this._text='';this.classList={add:()=>{},remove:()=>{}};}
 set textContent(value){this._text=String(value);this.children=[];}get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
 set innerHTML(value){throw new Error('HTML insertion is forbidden in this DOM test');}
 append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this._text='';this.children=nodes;}
 setAttribute(key,value){this.attributes[key]=String(value);if(key==='open')this.open=true;}removeAttribute(key){delete this.attributes[key];if(key==='open')this.open=false;}
 addEventListener(key,handler){(this.listeners[key]||=[]).push(handler);}async fire(key,event={}){await Promise.all((this.listeners[key]||[]).map(handler=>handler({target:this,...event})));}
 showModal(){this.open=true;}close(){this.open=false;this.fire('close');}focus(){this.focused=true;}
}
function fakeDocument(){const nodes=new Map([...html.matchAll(/id="([^"]+)"/g)].map(match=>[match[1],new Node()]));const i18n=[...html.matchAll(/data-i18n="([^"]+)"/g)].map(match=>{const node=new Node();node.dataset.i18n=match[1];return node;});nodes.get('typeFilter').value='all';return {documentElement:new Node('html'),body:new Node('body'),getElementById:id=>nodes.get(id),createElement:tag=>new Node(tag),querySelectorAll:selector=>selector==='[data-i18n]'?i18n:[],nodes};}
function fakeStorage(extra={}){const values=new Map(Object.entries(extra)),reads=[],writes=[];return {getItem:key=>{reads.push(key);return values.get(key)||null;},setItem:(key,value)=>{writes.push([key,value]);values.set(key,value);},reads,writes};}
function reply(body,status=200){return {ok:status>=200&&status<300,status,json:async()=>structuredClone(body)};}
function fixture(response=firebaseTotals(),configured=true){const document=fakeDocument(),storage=fakeStorage({'ecolens-pro-state':'SECRET PERSONAL STATE'}),requests=[],downloads=[];const fetchImpl=async(url,options)=>{requests.push({url,options});return url==='./catalog.json'?reply(catalog):url==='./firebase-config.json'?reply(configured?config:{version:1,provider:'firebase',projectId:'',apiKey:'',databaseURL:''}):reply(response,response?.error?503:200);};const app=createPublicApp({document,storage,fetch:fetchImpl,download:(csv,name)=>downloads.push({csv,name})});return {document,storage,requests,downloads,app};}

test('standalone directory lists all 34 institutions and searchable university/school categories',()=>{
 assert.equal(catalog.length,34);assert.equal(new Set(catalog.map(row=>row.institutionId)).size,34);
 assert.equal(filterInstitutions(catalog,'BRAINWARE','university')[0].institutionId,'brainware');
 assert.ok(filterInstitutions(catalog,'New Town','university').length>2);assert.ok(filterInstitutions(catalog,'','school').length>10);assert.equal(filterInstitutions(catalog,'does not exist').length,0);
});
test('every HTML translation has complete EN/BN/HI copy and public asset links resolve',async()=>{
 for(const match of html.matchAll(/data-i18n="([^"]+)"/g)){assert.ok(TEXT[match[1]],match[1]);for(const language of ['en','bn','hi'])assert.ok(TEXT[match[1]][language]);}
 for(const path of ['./public.js','./styles.css','./assets/ecolens-mark.svg']){assert.ok(html.includes(path));assert.ok((await readFile(new URL(`./naac/${path.slice(2)}`,import.meta.url))).byteLength>0);}
 const ids=[...html.matchAll(/id="([^"]+)"/g)].map(match=>match[1]);assert.equal(new Set(ids).size,ids.length);
});
test('public schema rejects personal fields, spoofed scope and inconsistent estimates',()=>{
 const good=summary();assert.deepEqual(validatePublicSummary(good),good);
 for(const mutate of [data=>data.profiles=[{name:'Private student'}],data=>data.scope='this-device',data=>data.updatedAt=null,data=>data.institutions[0].studentNames=['Student'],data=>data.institutions[0].xp=20,data=>data.institutions[0].estimatedKg=10,data=>data.institutions[0].hasRecords=false,data=>data.institutions[0].itemsHandled=.5,data=>data.institutions[0].estimatedCo2Kg=Infinity,data=>data.institutions.push({...data.institutions[0]})]){const data=structuredClone(good);mutate(data);assert.throws(()=>validatePublicSummary(data),/INVALID_PUBLIC_REPORT/);}
});
test('unavailable shared totals use nulls and dashes rather than invented zero records',()=>{
 const rows=mergeCatalog(catalog);assert.equal(rows.length,34);assert.equal(aggregateTotals(rows),null);assert.equal(rows[0].estimatedKg,null);assert.equal(rows[0].available,false);
 const actual=mergeCatalog(catalog,validatePublicSummary(summary()));assert.equal(actual[1].estimatedKg,0);assert.equal(actual[1].hasRecords,false);assert.equal(aggregateTotals(actual).estimatedKg,3);
});
test('CSV exports aggregate columns only and protects spreadsheet formula cells',()=>{
 const rows=mergeCatalog(catalog,validatePublicSummary(summary()));const csv=reportCSV(rows,{updatedAt:summary().updatedAt});assert.ok(csv.includes('User-confirmed diversion estimate'));assert.ok(csv.includes('Brainware University'));assert.ok(csv.includes('2026-10-13T07:00:00.000Z'));
 assert.ok(!/student name|profileId|activityXP|photo|scanId|SECRET/i.test(csv));const formula=reportCSV([{...rows[0],name:'=HYPERLINK("test")'}]);assert.ok(formula.includes('"\'=HYPERLINK(""test"")"'));
 const missing=reportCSV(mergeCatalog(catalog));assert.ok(missing.includes('Shared totals unavailable'));assert.ok(!missing.includes('No shared activity recorded'));
});
test('public page never imports main app or reads its personal state storage',async()=>{
 assert.ok(!/^import\s/m.test(source));assert.ok(!/ecolens-pro-state|localStorage\.clear|\.\/core\.js|\.\.\/data\.js|\.\.\/app\.js/.test(source));
 const fx=fixture();await fx.app.refresh();assert.deepEqual(fx.storage.reads,['ecolens-public-preferences']);assert.equal(fx.storage.writes.length,0);assert.deepEqual(fx.requests.map(r=>r.url),['./catalog.json','./firebase-config.json',publicURL]);for(const request of fx.requests){assert.equal(request.options.credentials,'omit');assert.equal(request.options.body,undefined);assert.equal(request.options.method,undefined);assert.equal(request.options.headers?.Authorization,undefined);}
 await fx.app.refresh();assert.deepEqual(fx.requests.slice(3).map(r=>r.url),[publicURL]);assert.ok(!JSON.stringify(fx.requests).includes(config.apiKey));
});
test('DOM renders 34 cards, opens selected institution report, filters and exports',async()=>{
 const fx=fixture();await fx.app.refresh();const $=id=>fx.document.getElementById(id);assert.equal(fx.app.getState().status,'available');assert.equal($('institutionGrid').children.length,34);assert.equal($('totalSorted').textContent,'3 kg');
 const button=$('institutionGrid').children[0].children.at(-1);await button.fire('click');assert.equal($('institutionDialog').open,true);assert.equal($('dialogTitle').textContent,'Brainware University');assert.ok($('dialogMetrics').textContent.includes('2 kg'));assert.equal($('exportInstitution').disabled,false);
 await $('exportInstitution').fire('click');assert.equal(fx.downloads.length,1);assert.ok(fx.downloads[0].name.includes('brainware'));assert.ok(!fx.downloads[0].csv.includes('Jadavpur University'));
 await $('dialogDone').fire('click');assert.equal($('institutionDialog').open,false);assert.equal(button.focused,true);
 $('search').value='Jadavpur';await $('search').fire('input');assert.equal($('institutionGrid').children.length,1);assert.ok($('institutionGrid').textContent.includes('Jadavpur University'));
 $('typeFilter').value='school';await $('typeFilter').fire('change');assert.equal($('institutionGrid').children.length,0);assert.equal($('emptyResults').hidden,false);
 await $('exportAll').fire('click');assert.ok(fx.downloads[1].csv.includes('Brainware University'));assert.ok(fx.downloads[1].csv.includes('Jadavpur University'));
});
test('language and theme controls persist only their public preferences',async()=>{
 const fx=fixture();await fx.app.refresh();const $=id=>fx.document.getElementById(id);$('language').value='bn';await $('language').fire('change');assert.equal(fx.document.documentElement.lang,'bn');assert.equal($('statusTitle').textContent,TEXT.available.bn);
 await $('theme').fire('click');assert.equal(fx.document.documentElement.dataset.theme,'dark');assert.equal($('theme').attributes['aria-label'],TEXT.lightTheme.bn);
 $('language').value='hi';await $('language').fire('change');assert.equal($('statusTitle').textContent,TEXT.available.hi);assert.ok($('institutionGrid').textContent.includes(TEXT.openReport.hi));for(const [key,value]of fx.storage.writes){assert.equal(key,'ecolens-public-preferences');assert.deepEqual(Object.keys(JSON.parse(value)).sort(),['language','theme']);}
 assert.deepEqual(readPreferences({getItem:()=>'{bad'}),{language:'en',theme:null});assert.deepEqual(readPreferences({getItem:()=>JSON.stringify({language:'unknown',theme:'other',profileId:'secret'})}),{language:'en',theme:null});
});
test('reports remain readable with blocked browser storage and older dialog fallback',async()=>{
 const document=fakeDocument();document.getElementById('institutionDialog').showModal=undefined;const app=createPublicApp({document,storage:{getItem:()=>{throw new Error('blocked')},setItem:()=>{throw new Error('blocked')}},fetch:async(url)=>reply(url==='./catalog.json'?catalog:url==='./firebase-config.json'?config:firebaseTotals())});await app.refresh();assert.equal(app.getState().status,'available');await document.getElementById('theme').fire('click');assert.equal(app.getState().theme,'dark');app.openInstitution('brainware');assert.equal(document.getElementById('institutionDialog').open,true);app.closeDialog();assert.equal(document.getElementById('institutionDialog').open,false);
});
test('unconfigured service keeps directory visible and clearly disables report downloads',async()=>{
 const fx=fixture(null,false);await fx.app.refresh();const $=id=>fx.document.getElementById(id);assert.equal(fx.app.getState().status,'unconfigured');assert.equal($('institutionGrid').children.length,34);assert.equal($('totalSorted').textContent,'—');assert.equal($('exportAll').disabled,true);fx.app.openInstitution('brainware');assert.equal($('dialogAvailability').textContent,TEXT.totalsUnavailable.en);assert.equal($('exportInstitution').disabled,true);await $('exportAll').fire('click');assert.equal(fx.downloads.length,0);assert.equal(fx.requests.length,2);
});
test('missing Firebase config is unconfigured and never falls back to a legacy API',async()=>{
 const document=fakeDocument(),requests=[];const app=createPublicApp({document,fetch:async(url)=>{requests.push(url);return url==='./catalog.json'?reply(catalog):reply(null,404);}});await app.refresh();assert.equal(app.getState().status,'unconfigured');assert.equal(document.getElementById('institutionGrid').children.length,34);assert.deepEqual(requests,['./catalog.json','./firebase-config.json']);assert.equal(document.getElementById('totalSorted').textContent,'—');
});
test('failed refresh clears prior totals and malformed/private payloads never render',async()=>{
 const fx=fixture();await fx.app.refresh();const before=fx.app.getState();assert.equal(before.status,'available');
 const document=fakeDocument();let request=0;const app=createPublicApp({document,fetch:async(url)=>url==='./catalog.json'?reply(catalog):url==='./firebase-config.json'?reply(config):(++request===1?reply(firebaseTotals()):reply({error:'Permission denied'},403))});await app.refresh();assert.equal(document.getElementById('totalSorted').textContent,'3 kg');await app.refresh();assert.equal(app.getState().status,'unavailable');assert.equal(document.getElementById('totalSorted').textContent,'—');assert.equal(document.getElementById('exportAll').disabled,true);
 const leaked=firebaseTotals();leaked.brainware.studentNames=['PRIVATE NAME'];const bad=fixture(leaked);await bad.app.refresh();assert.equal(bad.app.getState().status,'unavailable');assert.ok(!bad.document.getElementById('institutionGrid').textContent.includes('PRIVATE NAME'));
});
test('late responses from a cancelled refresh cannot replace newer totals',async()=>{
 const document=fakeDocument();let resolveOld,calls=0;const old=new Promise(resolve=>resolveOld=resolve);const app=createPublicApp({document,fetch:async(url)=>url==='./catalog.json'?reply(catalog):url==='./firebase-config.json'?reply(config):(++calls===1?old:reply(firebaseTotals()))});
 const first=app.refresh();await new Promise(resolve=>setTimeout(resolve,0));await app.refresh();resolveOld(reply({error:{code:'SHARING_DISABLED'}},503));await first;assert.equal(app.getState().status,'available');assert.equal(document.getElementById('totalSorted').textContent,'3 kg');app.dispose();
});
