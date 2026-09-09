import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {spawn,spawnSync,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import os from 'node:os';
import {Store} from '../../gateway/curation/store.js';
import {createCurationApp} from '../../gateway/curation/app.js';
import {BOTFAILS_REVISION} from '../../contracts/curation.js';

test('CPU end-to-end: real media, sample references, immutable exports, restart and verified restore',{timeout:120000},async()=>{
 mkdirSync('runtime',{recursive:true});mkdirSync('artifacts/curation',{recursive:true});
 const root=mkdtempSync(path.resolve('runtime/curation-e2e-'));
 const python=process.env.CURATION_PYTHON??path.resolve(process.platform==='win32'?'runtime/curation-venv/Scripts/python.exe':'runtime/curation-venv/bin/python');
 const sources=path.join(root,'sources'),data=path.join(root,'data');
 const generated=spawnSync(python,['tests/curation/fixture.py',sources],{encoding:'utf8',env:{...process.env,TEMP:root,TMP:root}});
 assert.equal(generated.status,0,generated.stderr);
 const fixture=JSON.parse(generated.stdout);
 let store=new Store(data);
 let server=createCurationApp(store,sources,'fixture-internal-token').listen(0,'127.0.0.1');
 await once(server,'listening');
 let base='http://127.0.0.1:'+(server.address() as any).port;
 let worker:ChildProcess|undefined;
 const report:any={fixture:true,host_label:'local-'+os.platform()+'-'+os.arch(),cpu:os.cpus()[0]?.model,node:process.version,measurements:{},checks:[]};
 async function request(route:string,body?:unknown,method=body===undefined?'GET':'POST'){
 const response=await fetch(base+'/api/v1'+route,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 const value=await response.json();assert.ok(response.ok,JSON.stringify(value));return value;
 }
 async function waitJob(id:string){
 const deadline=Date.now()+60000;
 while(Date.now()<deadline){const j=await request('/jobs/'+id);if(j.status==='failed')throw new Error(j.error);
 if(j.status==='completed')return j;if(j.status==='cancelled')throw new Error('Unexpected cancellation');
 await new Promise(r=>setTimeout(r,50));}throw new Error('Job timeout');
 }
 async function stop(){
 if(worker&&worker.exitCode===null){worker.kill();await once(worker,'exit');}worker=undefined;
 await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();
 }
 try{
 worker=spawn(python,['worker/curation.py'],{env:{...process.env,CURATION_WORKER_TOKEN:'fixture-internal-token',CURATION_API:base,CURATION_DATA_DIR:data,CURATION_SOURCE_ROOT:sources,TEMP:root,TMP:root},stdio:'ignore'});
 const start=performance.now();
 const source=await request('/projects/default/sources',{...fixture,name:'Explicit end-to-end fixture',revision:BOTFAILS_REVISION});
 const pending=await request('/jobs');
 await waitJob(pending.find((j:any)=>j.kind==='preflight').id);
 const ready=await request('/sources/'+source.id);
 assert.deepEqual(ready.plan.findings,[]);
 const imported=await request('/sources/'+source.id+'/imports',{confirm_bytes:ready.plan.estimated_bytes});
 const importResult=await waitJob(imported.id);
 report.measurements.worker_lifetime_peak_rss_bytes=importResult.metrics.worker_lifetime_peak_rss_bytes;
 assert.ok(importResult.metrics.worker_lifetime_peak_rss_bytes>0);
 report.measurements.preflight_and_import_ms=performance.now()-start;
 report.measurements.selected_source_bytes=ready.plan.estimated_bytes;
 const listing=await request('/queries',{text:'fixture'});
 assert.equal(listing.episodes.length,1);
 const episode=listing.episodes[0];
 assert.equal(episode.streams.length,2);assert.deepEqual(episode.findings,[]);assert.equal(episode.split,'test');
 const movie=await fetch(base+'/api/v1/artifacts/'+episode.streams[0].artifact_id,{headers:{Range:'bytes=0-31'}});
 assert.equal(movie.status,206);assert.equal((await movie.arrayBuffer()).byteLength,32);
 const previewStart=performance.now();
 const preview=await waitJob((await request('/episodes/'+episode.id+'/samples',{offset:0,limit:3})).id);
 report.measurements.first_sample_preview_ms=performance.now()-previewStart;
 assert.deepEqual(preview.result.rows.map((r:any)=>r.timestamp),[0,.033,.1]);
 assert.equal(preview.result.video_references[2].length,2);
 const review=await request('/episodes/'+episode.id+'/reviews',{role:'unknown',rationale:'Synthetic fixture only',evidence:[episode.artifacts[0].id],interval:null});
 const collection=await request('/projects/default/collections',{name:'Frozen fixture',intended_use:'pipeline evaluation'});
 await request('/collections/'+collection.id,{revision:1,members:[{episode_id:episode.id,interval:null}]},'PATCH');
 const version=await request('/collections/'+collection.id+'/versions',{revision:2,review_ids:[review.id]});
 const exportJob=await waitJob((await request('/collection-versions/'+version.id+'/exports',{})).id);
 assert.equal(exportJob.result.artifacts.length,3);
 const manifestArtifact=exportJob.result.artifacts.find((a:any)=>a.kind==='manifest.json');
 const manifest=await (await fetch(base+'/api/v1/artifacts/'+manifestArtifact.id)).json();
 assert.deepEqual(manifest.collection.members,version.collection.members);
 assert.equal(manifest.reviews[0].id,review.id);
 const latencies=[];
 for(let i=0;i<20;i++){const t=performance.now();await request('/queries',{text:'fixture'});latencies.push(performance.now()-t);}
 latencies.sort((a,b)=>a-b);
 report.measurements.warm_query_p50_ms=latencies[9];report.measurements.warm_query_p95_ms=latencies[18];
 await stop();
 const backup=spawnSync(python,['worker/backup.py','backup',data,path.join(root,'backup'),'--sources',sources,'--services-stopped'],{encoding:'utf8'});
 assert.equal(backup.status,0,backup.stderr);
 const restored=spawnSync(python,['worker/backup.py','restore',path.join(root,'backup'),path.join(root,'restored')],{encoding:'utf8'});
 assert.equal(restored.status,0,restored.stderr);
 store=new Store(path.join(root,'restored/data'));
 server=createCurationApp(store,path.join(root,'restored/sources'),'fixture-internal-token').listen(0,'127.0.0.1');
 await once(server,'listening');base='http://127.0.0.1:'+(server.address() as any).port;
 assert.equal((await request('/collection-versions/'+version.id)).reviews[0].id,review.id);
 assert.equal((await request('/episodes/'+episode.id)).streams.length,2);
 const restoredVideo=await fetch(base+'/api/v1/artifacts/'+episode.streams[0].artifact_id,{headers:{Range:'bytes=0-7'}});
 assert.equal(restoredVideo.status,206);
 report.checks=['real-video full decode','two views grouped','native timestamp gap preserved','source video references','authorized range read','immutable manifest','cold backup checksums','restore and reopen'];
 report.status='passed';
 writeFileSync('artifacts/curation/e2e-report.json',JSON.stringify(report,null,2));
 }finally{
 await stop();rmSync(root,{recursive:true,force:true});
 }
});
