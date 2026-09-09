import { DatabaseSync } from 'node:sqlite';
import { mkdirSync,openSync,closeSync,readFileSync,writeFileSync,unlinkSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
export const now = () => new Date().toISOString();
export const id = () => randomUUID();
export class Store {
  db:DatabaseSync;
  private lock:string;
  private owner=id();
  readonly metadataLimit=Number(process.env.CURATION_METADATA_MAX_BYTES??268435456);
  constructor(readonly directory:string) {
    mkdirSync(directory,{recursive:true});
    if(!Number.isSafeInteger(this.metadataLimit)||this.metadataLimit<1048576)throw new Error('Metadata quota must be at least 1 MiB');
    this.lock=path.join(directory,'curation.lock');
    try{
      const old=JSON.parse(readFileSync(this.lock,'utf8'));
      let alive=true;try{process.kill(old.pid,0);}catch(e:any){if(e.code==='ESRCH')alive=false;}
      if(alive)throw new Error('Another curation API owns this data directory');
      unlinkSync(this.lock);
    }catch(e:any){if(e.code!=='ENOENT')throw e;}
    const lock=openSync(this.lock,'wx');writeFileSync(lock,JSON.stringify({pid:process.pid,owner:this.owner}));closeSync(lock);
    this.db=new DatabaseSync(path.join(directory,'curation.sqlite'));
    this.db.exec('PRAGMA max_page_count='+Math.floor(this.metadataLimit/4096)+'; PRAGMA journal_size_limit=16777216; PRAGMA wal_autocheckpoint=256;');
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS episode_index(id TEXT PRIMARY KEY,source_id TEXT NOT NULL,project_id TEXT NOT NULL,
        task TEXT NOT NULL,split TEXT NOT NULL,metadata TEXT NOT NULL,annotations TEXT NOT NULL);
      CREATE VIRTUAL TABLE IF NOT EXISTS episode_fts USING fts5(id UNINDEXED,metadata,annotations);
      PRAGMA user_version=1;`);
    if(!this.get('project','default'))this.put('project','default',{id:'default',name:'Local workspace'});
  }
  get<T=any>(kind:string,key:string):T|undefined {
    const r=this.db.prepare('SELECT data FROM records WHERE kind=? AND id=?').get(kind,key);
    return r?JSON.parse(String(r.data)):undefined;
  }
  all<T=any>(kind:string):T[] {
    return this.db.prepare('SELECT data FROM records WHERE kind=? ORDER BY rowid DESC').all(kind).map(r=>JSON.parse(String(r.data)));
  }
  page<T=any>(kind:string,limit=40,offset=0):T[] {
    return this.db.prepare('SELECT data FROM records WHERE kind=? ORDER BY rowid DESC LIMIT ? OFFSET ?')
      .all(kind,limit,offset).map(r=>JSON.parse(String(r.data)));
  }
  count(kind:string):number {
    return Number(this.db.prepare('SELECT count(*) AS n FROM records WHERE kind=?').get(kind)?.n??0);
  }
  matching<T=any>(kind:string,field:string,value:string,limit=40,offset=0):T[]{
    return this.db.prepare('SELECT data FROM records WHERE kind=? AND json_extract(data,?)=? ORDER BY rowid DESC LIMIT ? OFFSET ?')
      .all(kind,'$.'+field,value,limit,offset).map(row=>JSON.parse(String(row.data)));
  }
  put(kind:string,key:string,value:unknown) {
    const encoded=JSON.stringify(value);
    if(Buffer.byteLength(encoded)>8*1024*1024)throw new Error('Metadata record exceeds 8 MiB admission limit');
    if(kind!=='job'){
      const pages=Number(this.db.prepare('PRAGMA page_count').get()?.page_count??0);
      const free=Number(this.db.prepare('PRAGMA freelist_count').get()?.freelist_count??0);
      const reserve=Math.min(this.metadataLimit/8,2*1024*1024);
      if((pages-free)*4096+Buffer.byteLength(encoded)+reserve>this.metadataLimit)
        throw Object.assign(new Error('Metadata quota reached; space is reserved for job failure records'),{status:507});
    }
    const previous=this.get<any>(kind,key);
    if(previous&&['review','version'].includes(kind)&&JSON.stringify(previous)!==encoded)throw new Error('Immutable record cannot be replaced');
    if(previous&&kind==='source'){
      const incoming=value as any;
      for(const field of ['id','project_id','snapshot','revision','license','tasks','episode_indices','origin','created_at'])
        if(JSON.stringify(previous[field])!==JSON.stringify(incoming[field]))throw new Error('Source identity is immutable; register a new source revision');
      if(previous.plan&&JSON.stringify(previous.plan)!==JSON.stringify(incoming.plan))throw new Error('Approved source manifest is immutable');
    }
    this.db.prepare('INSERT INTO records VALUES (?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data').run(kind,key,encoded);
  }
  transaction<T>(fn:()=>T):T { this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(e){this.db.exec('ROLLBACK');throw e;} }
  index(e:any,project:string,reviewText='') {
    // Raw upstream task text describes test anomalies. Keep it out of metadata-only retrieval.
    const metadata=[e.task,e.robot??'',e.split].join(' ');
    const annotations=[...(e.task_text??[]),...e.annotations.map((a:any)=>a.label),reviewText].join(' ');
    this.db.prepare('INSERT OR REPLACE INTO episode_index VALUES (?,?,?,?,?,?,?)').run(e.id,e.source_id,project,e.task,e.split,metadata,annotations);
    this.db.prepare('DELETE FROM episode_fts WHERE id=?').run(e.id);
    this.db.prepare('INSERT INTO episode_fts VALUES (?,?,?)').run(e.id,metadata,annotations);
  }
  close(){this.db.close();try{if(JSON.parse(readFileSync(this.lock,'utf8')).owner===this.owner)unlinkSync(this.lock);}catch(e:any){if(e.code!=='ENOENT')throw e;}}
}
