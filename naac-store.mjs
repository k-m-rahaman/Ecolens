import { NAAC_FIELDS, validateSnapshot, naacError } from './naac-api.js';
const SQL_FIELDS=['contributing_profiles','completed_quests','items_handled','estimated_kg','estimated_co2_kg','reported_diverted_kg','assumed_diverted_kg'];
function assertPublisher(hash) {if(typeof hash!=='string'||!/^[a-f0-9]{64}$/.test(hash))throw naacError('INVALID_TOKEN',401);}
export function quotaBuckets({updatedAt,clientHash,limits}) {
  const stamp=new Date(updatedAt),day=updatedAt.slice(0,10),minute=updatedAt.slice(0,16);
  return [
    {key:`minute:${minute}:${clientHash}`,limit:limits.perMinute,expiresAt:new Date(stamp.getTime()+120000).toISOString()},
    {key:`day:${day}:${clientHash}`,limit:limits.perDay,expiresAt:new Date(stamp.getTime()+172800000).toISOString()},
    {key:`global:${day}`,limit:limits.globalDay,expiresAt:new Date(stamp.getTime()+172800000).toISOString()}
  ];
}
function aggregatePublishers(publishers) {
  const totals=new Map();let updatedAt=null;
  for(const value of Object.values(publishers)){
    if(!updatedAt||value.updatedAt>updatedAt)updatedAt=value.updatedAt;
    for(const row of value.institutions){
      if(!totals.has(row.institutionId))totals.set(row.institutionId,{institutionId:row.institutionId,...Object.fromEntries(NAAC_FIELDS.map(field=>[field,0]))});
      const sum=totals.get(row.institutionId);for(const field of NAAC_FIELDS)sum[field]+=row[field];
    }
  }
  return {rows:[...totals.values()],updatedAt};
}
/* Load filesystem APIs only for the local adapter; this file also runs in a Worker. */
export function createJsonNaacStore(rootDir) {
  let serial=Promise.resolve();
  async function location(){const [{promises:fs},path]=await Promise.all([import('node:fs'),import('node:path')]);return {fs,path: path.default,file:path.default.join(rootDir,'.ecolens','private-naac.json')};}
  async function load(fs,file){
    try {
      const value=JSON.parse(await fs.readFile(file,'utf8'));
      if(value.version!==1||!value.publishers||typeof value.publishers!=='object'||Array.isArray(value.publishers)||!value.quotas||typeof value.quotas!=='object'||Array.isArray(value.quotas))throw new Error();
      for(const [hash,publisher] of Object.entries(value.publishers)){assertPublisher(hash);validateSnapshot({version:1,revision:publisher.revision,institutions:publisher.institutions});if(typeof publisher.updatedAt!=='string'||!Number.isFinite(Date.parse(publisher.updatedAt)))throw new Error();}
      return value;
    } catch(error){if(error.code==='ENOENT')return {version:1,publishers:{},quotas:{}};throw naacError('STORAGE_UNAVAILABLE',503);}
  }
  return {
    replacePublisher(hash,snapshot,options){
      const operation=serial.then(async()=>{
        assertPublisher(hash);const clean=validateSnapshot(snapshot),{fs,path,file}=await location(),data=await load(fs,file);
        if(data.publishers[hash]?.revision>=clean.revision)return {updatedAt:data.publishers[hash].updatedAt};
        for(const [key,quota]of Object.entries(data.quotas))if(quota.expiresAt<=options.updatedAt)delete data.quotas[key];
        const buckets=quotaBuckets(options);
        for(const bucket of buckets){const old=data.quotas[bucket.key];if(old&&(!Number.isSafeInteger(old.requests)||old.requests<0))throw naacError('STORAGE_UNAVAILABLE',503);if((old?.requests||0)>=bucket.limit)throw naacError('RATE_LIMIT',429);}
        for(const bucket of buckets)data.quotas[bucket.key]={requests:(data.quotas[bucket.key]?.requests||0)+1,expiresAt:bucket.expiresAt};
        data.publishers[hash]={updatedAt:options.updatedAt,revision:clean.revision,institutions:clean.institutions};
        const directory=path.dirname(file);await fs.mkdir(directory,{recursive:true,mode:0o700});
        const temporary=`${file}.tmp`;try{await fs.writeFile(temporary,JSON.stringify(data),{mode:0o600});await fs.rename(temporary,file);}catch{throw naacError('STORAGE_UNAVAILABLE',503);}
        return {updatedAt:options.updatedAt};
      });
      serial=operation.catch(()=>{});return operation;
    },
    async aggregatedRows(){await serial;const {fs,file}=await location();return aggregatePublishers((await load(fs,file)).publishers);}
  };
}
export function createD1NaacStore(db) {
  if(!db?.prepare||!db?.batch)throw naacError('STORAGE_UNAVAILABLE',503);
  return {
    async replacePublisher(hash,snapshot,options){
      assertPublisher(hash);const clean=validateSnapshot(snapshot);
      // Revision zero is a transaction-local placeholder for the foreign key.
      // Every mutation checks the old revision; the accepted revision is written
      // last, so an older request or a replay cannot restore a revoked snapshot.
      const gate='EXISTS (SELECT 1 FROM naac_publishers WHERE publisher_hash = ? AND revision < ?)';
      const statements=[db.prepare('INSERT INTO naac_publishers (publisher_hash, updated_at, revision) VALUES (?, ?, 0) ON CONFLICT(publisher_hash) DO NOTHING').bind(hash,options.updatedAt),db.prepare('DELETE FROM naac_write_quota WHERE expires_at < ?').bind(options.updatedAt)];
      for(const bucket of quotaBuckets(options))statements.push(db.prepare(`INSERT INTO naac_write_quota (bucket_key, requests, limit_value, expires_at) SELECT ?, 1, ?, ? WHERE ${gate} ON CONFLICT(bucket_key) DO UPDATE SET requests = requests + 1, limit_value = excluded.limit_value, expires_at = excluded.expires_at`).bind(bucket.key,bucket.limit,bucket.expiresAt,hash,clean.revision));
      statements.push(db.prepare(`DELETE FROM naac_institution_totals WHERE publisher_hash = ? AND ${gate}`).bind(hash,hash,clean.revision));
      for(const row of clean.institutions)statements.push(db.prepare(`INSERT INTO naac_institution_totals (publisher_hash, institution_id, ${SQL_FIELDS.join(', ')}) SELECT ${Array(9).fill('?').join(', ')} WHERE ${gate}`).bind(hash,row.institutionId,...NAAC_FIELDS.map(field=>row[field]),hash,clean.revision));
      statements.push(db.prepare('UPDATE naac_publishers SET updated_at = ?, revision = ? WHERE publisher_hash = ? AND revision < ?').bind(options.updatedAt,clean.revision,hash,clean.revision));
      statements.push(db.prepare('SELECT updated_at AS updatedAt FROM naac_publishers WHERE publisher_hash = ?').bind(hash));
      try {const results=await db.batch(statements);if(results.some(result=>result?.success===false))throw new Error('Batch failed');return {updatedAt:results.at(-1)?.results?.[0]?.updatedAt||options.updatedAt};}
      catch(error){if(/CHECK constraint failed.*(?:requests|limit_value|naac_write_quota)/i.test(String(error?.message)))throw naacError('RATE_LIMIT',429);throw naacError('STORAGE_UNAVAILABLE',503);}
    },
    async aggregatedRows(){
      const fields=NAAC_FIELDS.map((field,index)=>`SUM(${SQL_FIELDS[index]}) AS ${field}`).join(', ');
      try {
        // D1 batch gives both reads one consistent transaction; no installation identifiers are returned.
        const results=await db.batch([db.prepare(`SELECT institution_id AS institutionId, ${fields} FROM naac_institution_totals GROUP BY institution_id`),db.prepare('SELECT MAX(updated_at) AS updatedAt FROM naac_publishers')]);
        if(results.some(result=>result?.success===false))throw new Error();
        return {rows:results[0].results||[],updatedAt:results[1].results?.[0]?.updatedAt||null};
      }catch{throw naacError('STORAGE_UNAVAILABLE',503);}
    }
  };
}
