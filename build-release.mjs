import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
export const RELEASE='naac-v17';
const target=path.join(root,'releases',RELEASE);
const files=['app.js','core.js','data.js','inference.js','scan-flow.js','media.js','report.js','public-sync.js','public-config.js','firebase-sync.js','firebase-ai.js','firebase-ai-config.js','styles.css'];
await fs.mkdir(target,{recursive:true});
for(const name of files){
 let source=await fs.readFile(path.join(root,name),'utf8');
 if(['inference.js','firebase-ai.js'].includes(name))source=source.replaceAll('./vendor/','../../vendor/').replaceAll('./models/','../../models/');
 await fs.writeFile(path.join(target,name),source,'utf8');
}
console.log(`EcoLens ${RELEASE} interface prepared.`);
