import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source=path=>readFile(new URL(path,import.meta.url),'utf8');
const prefix='releases/naac-v10/';
const graph=['app.js','core.js','data.js','inference.js','scan-flow.js','media.js','report.js','public-sync.js','public-config.js','firebase-sync.js'];
test('new HTML and every application import use the same release outside old worker URLs',async()=>{
 const html=await source('index.html'),bootstrap=await source('bootstrap.js');assert.match(html,/src="bootstrap\.js"/);assert.match(html,/href="releases\/naac-v10\/styles\.css"/);assert.match(bootstrap,/import\('\.\/releases\/naac-v10\/app\.js'\)/);
 const legacy=new Set(['app.js','core.js','data.js','inference.js','scan-flow.js','media.js','report.js','public-sync.js','public-config.js','styles.css']);
 for(const file of graph){const code=await source(prefix+file);assert.ok(!legacy.has(prefix+file));for(const match of code.matchAll(/from\s+['"]([^'"]+)['"]/g)){assert.ok(match[1].startsWith('./'),`${file}: ${match[1]}`);await source(prefix+match[1].slice(2));}}
});
test('release code matches reviewed sources and retains the original model asset locations',async()=>{
 for(const file of [...graph,'styles.css']){let expected=await source(file);if(file==='inference.js')expected=expected.replaceAll('./vendor/','../../vendor/').replaceAll('./models/','../../models/');assert.equal(await source(prefix+file),expected,`${file} release needs rebuilding`);}
 const inference=await source(prefix+'inference.js');assert.ok(!inference.includes("new URL('./vendor/"));assert.ok(inference.includes('../../models/custom-yolo/GarbageDetector.onnx'));assert.ok(inference.includes('../../vendor/'));
});
