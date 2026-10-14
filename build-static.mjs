import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RELEASE } from './build-release.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const output=path.join(root,'dist');
const marker='.ecolens-static-build';
const interfaceFiles=['app.js','core.js','data.js','inference.js','scan-flow.js','media.js','report.js','public-sync.js','public-config.js','firebase-sync.js','styles.css'];
// Retain the previously published graph for visitors with an open older tab.
const interfaces=[...new Set([RELEASE,'naac-v9'])];
// This list is the publication boundary. Never serve the repository itself.
const files=[
 'index.html','bootstrap.js','sw.js','manifest.webmanifest','THIRD_PARTY_NOTICES.md',
 'assets/icon.svg','assets/ecolens-mark.svg','assets/ecolens-logo.svg','assets/images/Mascot.webp',
 ...interfaces.flatMap(version=>interfaceFiles.map(file=>`releases/${version}/${file}`)),
 ...['ort.min.js','ort-wasm-simd-threaded.mjs','ort-wasm-simd-threaded.wasm','tf.min.js','coco-ssd.min.js','LICENSE-onnxruntime.txt','LICENSE-tensorflow.txt'].map(file=>`vendor/${file}`),
 'models/custom-yolo/GarbageDetector.onnx','models/coco/model.json',
 ...Array.from({length:5},(_,i)=>`models/coco/group1-shard${i+1}of5`),
 ...['index.html','public.js','styles.css','catalog.json','firebase-config.json','assets/ecolens-mark.svg'].map(file=>`naac/${file}`)
];
let previous;
try{previous=await fs.lstat(output);}catch(error){if(error.code!=='ENOENT')throw error;}
if(previous){
 const info=previous;
 if(info.isSymbolicLink()||!info.isDirectory())throw new Error('The static output path must be a real directory.');
 const resolved=await fs.realpath(output);
 if(resolved!==path.join(await fs.realpath(root),'dist'))throw new Error('The static output escaped the project folder.');
 if(await fs.readFile(path.join(output,marker),'utf8')!=='EcoLens generated static files\n')throw new Error('Refusing to replace an unrecognized dist folder.');
 await fs.rm(output,{recursive:true});
}
await fs.mkdir(output,{recursive:true});
let bytes=0;
for(const file of files){
 const source=path.join(root,file),target=path.join(output,file);
 const info=await fs.lstat(source);
 if(!info.isFile()||info.isSymbolicLink())throw new Error(`Expected a regular public asset: ${file}`);
 const relative=path.relative(await fs.realpath(root),await fs.realpath(source));
 if(relative.startsWith('..')||path.isAbsolute(relative))throw new Error(`Asset escaped the project folder: ${file}`);
 await fs.mkdir(path.dirname(target),{recursive:true});
 await fs.copyFile(source,target);bytes+=info.size;
}
await fs.writeFile(path.join(output,marker),'EcoLens generated static files\n');
console.log(JSON.stringify({release:RELEASE,publicFiles:files.length,bytes,output:'dist',privateFilesPublished:false}));
