import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';

const html=await readFile(new URL('./index.html',import.meta.url),'utf8');
const bootstrap=await readFile(new URL('./bootstrap.js',import.meta.url),'utf8');
const inline=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
const canonical='https://ecolens-live.web.app/';
const pages=[
 ['https://k-m-rahaman.github.io/Ecolens/#scan',canonical+'#scan'],
 ['https://k-m-rahaman.github.io/Ecolens?photo=private#journey',canonical+'#journey'],
 ['https://k-m-rahaman.github.io/Ecolens/index.html?cloudConsent=true#reports',canonical+'#reports'],
 ['https://k-m-rahaman.github.io/Ecolens/#settings',canonical+'#settings'],
 ['https://k-m-rahaman.github.io/Ecolens/?token=private#https://untrusted.example/',canonical+'#scan'],
 ['https://k-m-rahaman.github.io/Ecolens/#scan?photo=private',canonical+'#scan'],
 ['https://k-m-rahaman.github.io/Ecolens/',canonical+'#scan'],
 ['https://ecolens-live.web.app/#scan',null],
 ['https://ecolens-live.firebaseapp.com/#settings',null],
 ['http://localhost:3000/#scan',null],
 ['http://127.0.0.1:3000/Ecolens/#scan',null],
 ['https://k-m-rahaman.github.io/AnotherProject/#scan',null],
 ['https://k-m-rahaman.github.io/Ecolens-copy/#scan',null],
 ['https://k-m-rahaman.github.io.untrusted.example/Ecolens/#scan',null]
];

test('HTML redirects the exact legacy project before app resources without touching stored data',()=>{
 assert.ok(inline,'early inline script exists');
 assert.ok(html.indexOf('<script>')<html.indexOf('rel="stylesheet"'));
 assert.ok(html.indexOf('<script>')<html.indexOf('src="bootstrap.js"'));
 for(const [url,destination] of pages){
  const redirects=[],location=new URL(url),storageCalls=[];
  location.replace=value=>redirects.push(value);
  const document={documentElement:{dataset:{},style:{}}};
  const localStorage={getItem:key=>{storageCalls.push(['getItem',key]);return null;},setItem(){assert.fail('no storage writes');},removeItem(){assert.fail('no storage deletion');},clear(){assert.fail('no storage clearing');}};
  vm.runInNewContext(inline,{location,document,localStorage,window:{matchMedia:()=>({matches:false})}});
  assert.deepEqual(redirects,destination?[destination]:[],url);
  if(destination)assert.deepEqual(storageCalls,[],`legacy redirect must not read private profiles: ${url}`);
  else assert.equal(document.documentElement.dataset.theme,'light',url);
 }
});

// Native VM dynamic-import hooks need this Node flag. Exercise the real entry
// source in an isolated process instead of replacing its import or redirect code.
const runner=`
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const {code,pages}=JSON.parse(readFileSync(0,'utf8'));
const results=[];
for(const [url] of pages){
 const redirects=[],imports=[],location=new URL(url);
 location.replace=value=>redirects.push(value);
 const context=vm.createContext({location,document:{getElementById(){throw new Error('The app import must resolve without a loading error');}}});
 const entry=new vm.SourceTextModule(code,{context,importModuleDynamically:async specifier=>{
  imports.push(specifier);
  const app=new vm.SyntheticModule([],()=>{},{context});
  await app.link(()=>{});await app.evaluate();return app;
 }});
 await entry.link(()=>{});await entry.evaluate();
 await new Promise(resolve=>setImmediate(resolve));
 results.push({url,redirects,imports});
}
process.stdout.write(JSON.stringify(results));
`;

test('bootstrap redirects cached legacy HTML without importing the app and preserves supported entries',()=>{
 const run=spawnSync(process.execPath,['--experimental-vm-modules','--input-type=module','-e',runner],{input:JSON.stringify({code:bootstrap,pages}),encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);
 const results=JSON.parse(run.stdout);
 for(let index=0;index<pages.length;index++){
  const [url,destination]=pages[index],result=results[index];
  assert.deepEqual(result.redirects,destination?[destination]:[],url);
  if(destination)assert.deepEqual(result.imports,[],`legacy host must not start local/cloud AI: ${url}`);
  else {assert.equal(result.imports.length,1,url);assert.match(result.imports[0],/^\.\/releases\/naac-v\d+\/app\.js$/);}
 }
});
