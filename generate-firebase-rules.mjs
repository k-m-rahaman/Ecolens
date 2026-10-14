/* Spark-compatible rules: one public aggregate plus private anonymous ownership. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { INSTITUTIONS } from './data.js';

export const FIREBASE_NAAC_NAMESPACE='ecolensNaacV1';
export const FIREBASE_TOTAL_FIELDS=Object.freeze(['contributingProfiles','completedQuests','itemsHandled','estimatedMicroKg','estimatedCo2MicroKg','reportedDivertedMicroKg','assumedDivertedMicroKg']);
const COUNTS=new Set(FIREBASE_TOTAL_FIELDS.slice(0,3));
const anonymous="auth !== null && auth.token.firebase.sign_in_provider === 'anonymous'";
const existsValue=(node,field)=>`(${node}.child('${field}').exists() ? ${node}.child('${field}').val() : 0)`;
const integer=(node,maximum)=>`${node}.isNumber() && ${node}.val() >= 0 && ${node}.val() <= ${maximum} && ${node}.val() % 1 === 0 && ${node}.getPriority() === null`;
const all=(parts)=>parts.map(part=>`(${part})`).join(' && ');

export function generateFirebaseNaacNamespace(catalog=INSTITUTIONS){
  const ids=[...new Set(catalog.map(row=>row.id))];
  if(!ids.length||ids.some(id=>typeof id!=='string'||!/^[-A-Za-z0-9_]+$/.test(id)))throw new Error('Institution IDs must be safe Firebase path keys.');
  const known=ids.map(id=>`$institution === '${id}'`).join(' || ');
  const oldPublic="root.child('ecolensNaacV1/publicInstitutions').child($institution)";
  const oldOwn="root.child('ecolensNaacV1/contributions').child(auth.uid).child($institution)";
  const oldPublisher="root.child('ecolensNaacV1/publishers').child(auth.uid)";
  const futureOwn="newData.parent().parent().child('contributions').child(auth.uid).child($institution)";
  const futurePublic="newData.parent().parent().parent().child('publicInstitutions').child($institution)";
  const newRevision=(node)=>all([`${node}.child('revision').isNumber()`,`${node}.child('revision').val() > 0`,`${node}.child('revision').val() <= 9007199254740991`,`${node}.child('revision').val() % 1 === 0`,`${node}.child('revision').val() > ${existsValue(oldOwn,'revision')}`]);
  const publisherRelation=(namespace,ownNode)=>{
    const publisher=`${namespace}.child('publishers').child(auth.uid)`;
    return all([`${publisher}.exists()`,`${publisher}.child('revision').val() > ${existsValue(oldPublisher,'revision')}`,`${ownNode}.child('revision').val() === ${publisher}.child('revision').val()`,`${ownNode}.child('updatedAt').val() === ${publisher}.child('updatedAt').val()`]);
  };
  const totalsRelation=(publicNode,ownNode)=>FIREBASE_TOTAL_FIELDS.map(field=>`${publicNode}.child('${field}').val() === ${existsValue(oldPublic,field)} + ${ownNode}.child('${field}').val() - ${existsValue(oldOwn,field)}`);
  function record(publicRecord){
    const fields=[...FIREBASE_TOTAL_FIELDS,...(publicRecord?[]:['revision']),'updatedAt'];
    const base=[`newData.hasChildren(${JSON.stringify(fields)})`,'newData.getPriority() === null',"newData.child('updatedAt').val() === now",known,"newData.child('estimatedMicroKg').val() === newData.child('reportedDivertedMicroKg').val() + newData.child('assumedDivertedMicroKg').val()"];
    if(publicRecord)base.push(`${futureOwn}.exists()`,newRevision(futureOwn),publisherRelation('newData.parent().parent()',futureOwn),`newData.child('updatedAt').val() === ${futureOwn}.child('updatedAt').val()`,...totalsRelation('newData',futureOwn));
    else base.push(newRevision('newData'),publisherRelation('newData.parent().parent().parent()','newData'),`${futurePublic}.exists()`,`newData.child('updatedAt').val() === ${futurePublic}.child('updatedAt').val()`,...totalsRelation(futurePublic,'newData'));
    const node={'.write':publicRecord?`${anonymous} && newData.exists()`:`${anonymous} && auth.uid === $uid && newData.exists()`,'.validate':all(base)};
    for(const field of FIREBASE_TOTAL_FIELDS){
      const maximum=publicRecord?(COUNTS.has(field)?1_000_000_000:1_000_000_000_000_000):(field==='contributingProfiles'?1000:COUNTS.has(field)?1_000_000:1_000_000_000_000);
      node[field]={'.validate':integer('newData',maximum)};
    }
    if(!publicRecord)node.revision={'.validate':all([integer('newData',9007199254740991),'newData.val() > 0'])};
    node.updatedAt={'.validate':all([integer('newData',9007199254740991),'newData.val() === now'])};
    node.$other={'.validate':false};
    return node;
  }
  const ownerRows="newData.parent().parent().child('contributions').child($uid)";
  const publisher={
    '.read':`${anonymous} && auth.uid === $uid`,
    '.write':`${anonymous} && auth.uid === $uid && newData.exists()`,
    '.validate':all(["newData.hasChildren(['revision','updatedAt'])",'newData.getPriority() === null',"newData.child('updatedAt').val() === now",`newData.child('revision').val() > ${existsValue('data','revision')}`,...ids.map(id=>{
      const row=`${ownerRows}.child('${id}')`;
      return `!${row}.exists() || (${row}.child('revision').val() === newData.child('revision').val() && ${row}.child('updatedAt').val() === newData.child('updatedAt').val())`;
    })]),
    revision:{'.validate':all([integer('newData',9007199254740991),'newData.val() > 0'])},
    updatedAt:{'.validate':all([integer('newData',9007199254740991),'newData.val() === now'])},
    $other:{'.validate':false}
  };
  return {[FIREBASE_NAAC_NAMESPACE]:{
    '.read':false,'.write':false,
    publicInstitutions:{'.read':true,'$institution':record(true)},
    contributions:{'$uid':{'.read':`${anonymous} && auth.uid === $uid`,'$institution':record(false)}},
    publishers:{'$uid':publisher},
    $other:{'.read':false,'.write':false}
  }};
}

export function mergeFirebaseNaacRules(existing,catalog=INSTITUTIONS){
  if(!existing||typeof existing!=='object'||Array.isArray(existing)||!existing.rules||typeof existing.rules!=='object'||Array.isArray(existing.rules))throw new Error('An existing Firebase rules object is required.');
  // Child denials cannot revoke an ancestor grant in RTDB. A permissive root
  // therefore cannot safely receive this namespace without changing its policy.
  for(const key of ['.read','.write'])if(![undefined,false,'false'].includes(existing.rules[key]))throw new Error('Existing root access could expose or bypass the private NAAC namespace. Use deny-by-default root rules before merging.');
  return {...existing,rules:{...existing.rules,...generateFirebaseNaacNamespace(catalog)}};
}

export async function writeFirebaseRules(directory=path.dirname(fileURLToPath(import.meta.url))){
  const namespace=generateFirebaseNaacNamespace();
  // This is the mergeable subtree for an existing project. Do not replace its
  // unrelated rules: merge only this namespace under the existing "rules".
  await fs.writeFile(path.join(directory,'firebase.naac.rules.json'),JSON.stringify(namespace,null,2)+'\n');
  // Complete deny-by-default file for the local emulator or a NEW database.
  await fs.writeFile(path.join(directory,'firebase.database.rules.json'),JSON.stringify({rules:{'.read':false,'.write':false,...namespace}},null,2)+'\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await writeFirebaseRules();
