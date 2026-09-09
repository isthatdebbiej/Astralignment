import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../../gateway/curation/store.js';
import {createCurationApp,contained} from '../../gateway/curation/app.js';
import {BOTFAILS_REVISION} from '../../contracts/curation.js';

test('curation: durable reviews, immutable collections, bounded intervals, search isolation and worker leases',async()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),'curation-test-'));
 mkdirSync(path.join(root,'sources','snapshot'),{recursive:true});
 const store=new Store(path.join(root,'db'));
 const server=createCurationApp(store,path.join(root,'sources'),'test-worker-token').listen(0,'127.0.0.1');
 await new Promise<void>(r=>server.once('listening',r));
 const url='http://127.0.0.1:'+(server.address() as any).port;
 async function call(route:string,body?:any,method=body?'POST':'GET',worker=false){
   const result=await fetch(url+'/api/v1'+route,{method,headers:{'Content-Type':'application/json',...(worker?{Authorization:'Bearer test-worker-token'}:{})},body:body?JSON.stringify(body):undefined});
   return {status:result.status,data:result.status===204?null:await result.json()};
 }
 try{
 const source=(await call('/projects/default/sources',{name:'Clearly labeled fixture',snapshot:'snapshot',revision:BOTFAILS_REVISION,tasks:['test/fixture'],license:'fixture',origin:'fixture'})).data;
 assert.ok(source.id);
 assert.equal((await call('/internal/claim',{})).status,401);
 const job=(await call('/internal/claim',{},'POST',true)).data;
 assert.equal((await call('/internal/claim',{},'POST',true)).status,204);
 assert.equal((await call('/internal/jobs/'+job.id,{attempt:99},'POST',true)).status,409);
 assert.equal((await call('/internal/jobs/'+job.id,{attempt:job.attempt,status:'completed',result:{estimated_bytes:1,files:[],episodes:[],findings:[]}},'POST',true)).status,400);
 await call('/internal/jobs/'+job.id,{attempt:job.attempt,status:'completed',result:{estimated_bytes:0,files:[],episodes:[],findings:[]}},'POST',true);
 const episode={id:'e1',source_id:source.id,source_episode:'0',family_id:'family1',task:'coffee',split:'test',
 origin:'fixture',robot:'so100',duration:2,fps:30,frames:60,upstream_splits:{train:'0:1'},
 task_text:['hidden spilling annotation'],streams:[{id:'s1',kind:'video',artifact_id:'a1',timing:'unknown'}],
 artifacts:[{id:'a1',path:'snapshot/example.mp4',sha256:'fixture',bytes:1,kind:'video'}],
 annotations:[{label:'spilling',start_frame:0,end_frame:30,evidence:'a1'}],findings:[],channels:[]};
 store.put('episode',episode.id,episode);store.index(episode,'default');
 assert.equal((await call('/queries',{text:'spilling',mode:'metadata'})).data.episodes.length,0);
 assert.equal((await call('/queries',{text:'spilling',mode:'annotations'})).data.episodes.length,1);
 assert.equal((await call('/queries',{text:'coffee',mode:'metadata'})).data.episodes.length,1);
 assert.equal((await call('/episodes/e1/reviews',{role:'recovery',rationale:'fixture review',evidence:['a1'],interval:{stream_id:'s1',unit:'frames',start:50,end:61}})).status,400);
 assert.equal((await call('/episodes/e1/reviews',{role:'recovery',rationale:'fixture review',evidence:['other']})).status,400);
 const first=(await call('/episodes/e1/reviews',{role:'recovery',rationale:'fixture review',evidence:['a1']})).data;
 const c=(await call('/projects/default/collections',{name:'Fixture selection',intended_use:'evaluation only'})).data;
 const updated=(await call('/collections/'+c.id,{revision:1,members:[{episode_id:'e1',interval:null}]},'PATCH')).data;
 assert.equal(updated.revision,2);
 const detail=(await call('/collections/'+c.id)).data;
 assert.equal(detail.episodes[0].family_id,'family1');
 assert.equal(detail.reviews[0].id,first.id);
 assert.equal((await call('/collections/'+c.id,{revision:2,members:[],exclusions:[{episode_id:'unknown',reason:'fixture'}]},'PATCH')).status,404);
 const renamed=(await call('/collections/'+c.id,{revision:2,name:'Renamed fixture',intended_use:'inspection',members:updated.members},'PATCH')).data;
 assert.equal(renamed.name,'Renamed fixture');
 assert.equal((await call('/collections/'+c.id,{revision:1,members:[]},'PATCH')).status,409);
 assert.equal((await call('/collections/'+c.id+'/versions',{revision:2,review_ids:[first.id]})).status,409);
 assert.equal((await call('/collections/'+c.id+'/versions',{})).status,400);
 const version=(await call('/collections/'+c.id+'/versions',{revision:3,review_ids:[first.id]})).data;
 const second=(await call('/episodes/e1/reviews',{role:'unknown',rationale:'updated fixture review',evidence:['a1']})).data;
 assert.equal(second.supersedes,first.id);
 assert.equal((await call('/queries',{reviewed_role:'recovery'})).data.episodes.length,0);
 assert.equal((await call('/queries',{reviewed_role:'unknown',robot:'so100',source_label:'spilling',integrity:'no-findings'})).data.episodes.length,1);
 assert.equal((await call('/queries',{modality:'nonexistent'})).data.total,0);
 assert.equal((await call('/collections/'+c.id+'/versions',{revision:3,review_ids:[first.id]})).status,409);
 const later=(await call('/collections/'+c.id+'/versions',{revision:3,review_ids:[first.id,second.id]})).data;
 assert.equal((await call('/collection-versions/'+version.id+'/compare/'+later.id)).data.reviews_added[0].id,second.id);
 assert.equal((await call('/collection-versions/'+version.id)).data.reviews.length,1);
 assert.equal((await call('/episodes/e1')).data.reviews.length,2);
 const exportJob=(await call('/collection-versions/'+version.id+'/exports',{})).data;
 await call('/jobs/'+exportJob.id+'/cancel',{});
 assert.equal((await call('/jobs/'+exportJob.id)).data.status,'cancelled');
 const recovery=(await call('/collection-versions/'+version.id+'/exports',{})).data;
 const leased=(await call('/internal/claim',{},'POST',true)).data;
 assert.equal(leased.id,recovery.id);
 store.put('job',leased.id,{...leased,updated_at:'2000-01-01T00:00:00.000Z'});
 const resumed=(await call('/internal/claim',{},'POST',true)).data;
 assert.equal(resumed.attempt,2);
 assert.ok(resumed.history.some((h:any)=>h.status==='lease-expired'));
 assert.equal((await call('/internal/jobs/'+leased.id,{attempt:1,status:'completed',result:{}},'POST',true)).status,409);
 await call('/jobs/'+leased.id+'/cancel',{});
 const hostile=await fetch(url+'/api/v1/sources',{headers:{Origin:'https://hostile.example'}});
 assert.equal(hostile.status,403);
 assert.throws(()=>contained(path.join(root,'sources'),'../db/curation.sqlite'));
 store.close();
 const reopened=new Store(path.join(root,'db'));
 assert.equal(reopened.all('review').length,2);
 assert.equal(reopened.get<any>('version',version.id).reviews[0].id,first.id);
 assert.equal(reopened.get<any>('job',exportJob.id).status,'cancelled');
 reopened.close();
 }finally{
 await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
 rmSync(root,{recursive:true,force:true});
 }
});
