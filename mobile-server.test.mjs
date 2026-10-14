import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { createEcolensServer, privateLanHosts } from './server.mjs';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '.ecolens', 'test-fixtures');
async function rootFor(t) {
  await fs.mkdir(fixtures, { recursive: true });
  const root = await fs.mkdtemp(path.join(fixtures, 'mobile-'));
  t.after(async () => { assert.equal(path.dirname(root), fixtures); await fs.rm(root, { recursive: true, force: true }); });
  await fs.writeFile(path.join(root, 'index.html'), '<h1>EcoLens</h1>');
  return root;
}
function request(server, { host='127.0.0.1:8787', url='/', method='GET', body='', origin, onResponse }={}) {
  return new Promise(resolve => {
    const req=Readable.from(body?[Buffer.from(body)]:[]);
    Object.assign(req,{url,method,headers:{host,...(origin?{origin}:{}),'content-type':'application/json'},socket:{remoteAddress:'192.168.42.3'}});
    const res=new EventEmitter();
    Object.assign(res,{headersSent:false,writableEnded:false,destroyed:false,writeHead(status,headers){this.status=status;this.headers=headers;this.headersSent=true;},end(data){this.writableEnded=true;resolve({status:this.status,body:String(data||'')});}});
    onResponse?.(res);
    server.emit('request',req,res);
  });
}
test('LAN preview is explicit and accepts only private IPv4 addresses',()=>{
  assert.deepEqual(privateLanHosts({LAN_HOSTS:'192.168.42.2'}),[]);
  const hosts=privateLanHosts({LAN_PREVIEW:'1',LAN_HOSTS:'192.168.42.2,10.42.3.4,172.20.1.2,172.32.1.2,8.8.8.8,192.168.1.300,evil.example'});
  for(const host of ['192.168.42.2','10.42.3.4','172.20.1.2'])assert.ok(hosts.includes(host));
  for(const host of ['172.32.1.2','8.8.8.8','192.168.1.300','evil.example'])assert.ok(!hosts.includes(host));
});
test('default local server rejects LAN host and opted-in preview serves phone upload page',async t=>{
  const rootDir=await rootFor(t),host='192.168.42.2:8787';
  assert.equal((await request(createEcolensServer({rootDir,env:{}}),{host})).status,403);
  const server=createEcolensServer({rootDir,env:{LAN_PREVIEW:'1',LAN_HOSTS:'192.168.42.2'}});
  assert.equal((await request(server,{host})).status,200);
  assert.equal((await request(server,{host:'8.8.8.8:8787'})).status,403);
  assert.equal((await request(server,{host,url:'/api/status',origin:'https://untrusted.example'})).status,403);
});
test('disconnecting a phone cancels its provider request',async t=>{
  const rootDir=await rootFor(t);let response,providerSignal,started;
  const providerStarted=new Promise(resolve=>started=resolve);
  const server=createEcolensServer({rootDir,env:{GEMINI_API_KEY:'test-placeholder',FREE_TIER_ONLY:'1'},fetchImpl:async(_url,{signal})=>{providerSignal=signal;started();return new Promise(()=>{});}});
  const image=Buffer.from([255,216,255,224,0,0,0,0,0,0,0,0,0,0,255,217]).toString('base64');
  const pending=request(server,{url:'/api/analyze',method:'POST',origin:'http://127.0.0.1:8787',body:JSON.stringify({image,language:'en'}),onResponse:res=>response=res});
  await providerStarted;response.emit('close');
  assert.equal((await pending).status,499);assert.equal(providerSignal.aborted,true);
});
