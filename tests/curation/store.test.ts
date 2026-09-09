import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {Store} from '../../gateway/curation/store.js';
test('Linux recovers a stale lock whose PID now belongs to another process',{skip:process.platform!=='linux'},()=>{
 mkdirSync('runtime',{recursive:true});
 const directory=mkdtempSync(path.resolve('runtime/curation-pid-reuse-'));
 let store:Store|undefined;
 try {
  writeFileSync(path.join(directory,'curation.lock'),JSON.stringify({pid:process.pid,owner:'terminated owner',process_identity:'previous-boot:1'}));
  store=new Store(directory);
  assert.throws(()=>new Store(directory),/Another curation API/);
  assert.equal(store.db.prepare('PRAGMA integrity_check').get()?.integrity_check,'ok');
 }finally {store?.close();rmSync(directory,{recursive:true,force:true});}
});
test('one metadata writer, immutable records and SQLite quota failure remain recoverable',()=>{
 mkdirSync('runtime',{recursive:true});
 const directory=mkdtempSync(path.resolve('runtime/curation-store-test-'));
 const previous=process.env.CURATION_METADATA_MAX_BYTES;
 process.env.CURATION_METADATA_MAX_BYTES=String(1024*1024);
 let store:Store|undefined;
 try{
 store=new Store(directory);
 assert.throws(()=>new Store(directory),/Another curation API/);
 store.put('review','r',{id:'r',role:'unknown'});
 assert.throws(()=>store!.put('review','r',{id:'r',role:'failure'}),/Immutable/);
 store.put('source','s',{id:'s',project_id:'default',snapshot:'snapshot',revision:'a',license:'fixture',tasks:['test/fixture'],origin:'fixture',created_at:'fixture'});
 assert.throws(()=>store!.put('source','s',{id:'s',snapshot:'other'}),/immutable/);
 let failed=false;
 for(let index=0;index<100;index++){
 try{store.put('fixture','f'+index,{value:'x'.repeat(100000)});}catch{failed=true;break;}
 }
 assert.equal(failed,true,'SQLite must enforce the configured database limit');
 store.close();store=undefined;
 store=new Store(directory);
 assert.equal(store.get<any>('review','r').role,'unknown');
 assert.equal(store.db.prepare('PRAGMA integrity_check').get()?.integrity_check,'ok');
 }finally{store?.close();if(previous===undefined)delete process.env.CURATION_METADATA_MAX_BYTES;else process.env.CURATION_METADATA_MAX_BYTES=previous;rmSync(directory,{recursive:true,force:true});}
});
