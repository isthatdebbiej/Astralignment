import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
export const now = () => new Date().toISOString();
export const id = () => randomUUID();
export class Store {
  db:DatabaseSync;
  constructor(readonly directory:string) {
    mkdirSync(directory,{recursive:true});
    this.db=new DatabaseSync(path.join(directory,'curation.sqlite'));
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
  put(kind:string,key:string,value:unknown) {
    this.db.prepare('INSERT INTO records VALUES (?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data').run(kind,key,JSON.stringify(value));
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
  close(){this.db.close();}
}
