// Opt-in real-source qualification. Never downloads recordings or invents human reviews.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,statSync,readdirSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import path from 'node:path';
import os from 'node:os';
import express from 'express';
import {chromium,expect,type Browser} from '@playwright/test';
import {Store} from '../../gateway/curation/store.js';
import {createCurationApp} from '../../gateway/curation/app.js';
import {BOTFAILS_REVISION} from '../../contracts/curation.js';

const snapshot=process.env.CURATION_PUBLIC_SNAPSHOT;
if(!snapshot)throw new Error('Set CURATION_PUBLIC_SNAPSHOT to the explicitly acquired reference snapshot folder');
const sources=path.resolve(process.env.CURATION_SOURCE_ROOT??'runtime/sources');
const python=process.env.CURATION_PYTHON??'python';
mkdirSync('runtime',{recursive:true});mkdirSync('artifacts/curation',{recursive:true});
const root=mkdtempSync(path.resolve('runtime/public-qualification-')),store=new Store(path.join(root,'data'));
const app=createCurationApp(store,sources,'qualification-worker');app.use(express.static(path.resolve('dist')));app.get('/curation',(_q,r)=>r.sendFile(path.resolve('dist/index.html')));
const server=app.listen(0,'127.0.0.1');await once(server,'listening');
let browser:Browser|undefined;
const base='http://127.0.0.1:'+(server.address() as any).port;
const worker=spawn(python,['worker/curation.py'],{env:{...process.env,CURATION_API:base,CURATION_SOURCE_ROOT:sources,CURATION_DATA_DIR:store.directory,CURATION_WORKER_TOKEN:'qualification-worker'},stdio:['ignore','ignore','pipe'],windowsHide:true});
let workerErrors='';worker.stderr.on('data',b=>workerErrors+=b);
async function api(route:string,body?:unknown,method=body?'POST':'GET'){const r=await fetch(base+'/api/v1'+route,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const value=await r.json();assert.ok(r.ok,JSON.stringify(value));return value;}
async function job(id:string){const deadline=Date.now()+180000;while(Date.now()<deadline){const j=await api('/jobs/'+id);if(j.status==='completed')return j;if(['failed','cancelled'].includes(j.status))throw Error(JSON.stringify(j)+workerErrors);await new Promise(r=>setTimeout(r,100));}throw Error('Public qualification job timeout');}
async function preflight(source:any){const jobs=await api('/jobs');await job(jobs.find((j:any)=>j.kind==='preflight').id);return api('/sources/'+source.id);}
function bytes(folder:string):number{return readdirSync(folder,{withFileTypes:true}).reduce((n,e)=>n+(e.isDirectory()?bytes(path.join(folder,e.name)):statSync(path.join(folder,e.name)).size),0);}
try{
 let source=await preflight(await api('/projects/default/sources',{name:'Pinned BotFails reference episode',snapshot,tasks:['test/domotic_makingCoffee_anomaly'],episode_indices:[0],revision:BOTFAILS_REVISION,origin:'public recording',license:'BotFails pinned dataset card: Apache-2.0; source references only'}));
 const sourceFile=path.join(root,'source.json');writeFileSync(sourceFile,JSON.stringify(source));
 if(!existsSync(path.join(sources,snapshot,'.curation-upstream.json'))){
  const verification=spawnSync(python,['worker/verify_source.py',sourceFile,'--root',sources],{encoding:'utf8',timeout:120000});assert.equal(verification.status,0,verification.stderr);
  source=await preflight(await api('/sources/'+source.id+'/revisions',{}));
 }
 assert.equal(source.plan.verification.mode,'upstream-hashes-verified');
 const started=performance.now();const imported=await job((await api('/sources/'+source.id+'/imports',{confirm_bytes:source.plan.estimated_bytes})).id);
 const importMs=performance.now()-started;
 const results=await api('/queries',{source_id:source.id});assert.equal(results.total,1);
 const episode=results.episodes[0];assert.equal(episode.origin,'public recording');assert.equal(episode.frames,1045);assert.equal(episode.streams.length,2);assert.equal(episode.split,'test');assert.deepEqual(episode.findings,[]);
 const previewStart=performance.now();const preview=(await job((await api('/episodes/'+episode.id+'/samples',{offset:0,limit:64})).id)).result;const previewMs=performance.now()-previewStart;
 const checkFile=path.join(root,'evidence.json');writeFileSync(checkFile,JSON.stringify({episode,preview}));
 const independent=spawnSync(python,['-c',`import json,sys,csv,itertools;from pathlib import Path;import pyarrow.parquet as pq
v=json.loads(Path(sys.argv[1]).read_text());e=v['episode'];root=Path(sys.argv[2]);a=next(a for a in e['artifacts'] if a['kind']=='state/action');rows=pq.read_table(root/a['path']).to_pylist();assert len(rows)==e['frames'];assert [{k:r[k] for k in v['preview']['columns']} for r in rows[:64]]==v['preview']['rows'];a=next(a for a in e['artifacts'] if a['kind']=='source annotation');labels=[r[0].strip() for r in csv.reader((root/a['path']).open()) if r];actual=[]
for ann in e['annotations']:actual.extend([ann['label']]*(ann['end_frame']-ann['start_frame']))
assert actual==labels;assert len(labels)==e['frames'];print('Original Parquet rows and CSV categories match imported evidence')`,checkFile,sources],{encoding:'utf8'});assert.equal(independent.status,0,independent.stderr);
 const video=await fetch(base+'/api/v1/artifacts/'+episode.streams[0].artifact_id,{headers:{Range:'bytes=0-31'}});assert.equal(video.status,206);
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();await page.goto(base+'/curation?episode='+episode.id);
 for(const stream of episode.streams){await page.getByLabel('Recorded camera').selectOption(stream.id);await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState),{timeout:30000}).toBeGreaterThanOrEqual(2);}
 await page.screenshot({path:'artifacts/curation/public-episode.png',fullPage:true});await browser.close();browser=undefined;
 const c=await api('/projects/default/collections',{name:'Technical qualification reference',intended_use:'Automated format/integrity verification; semantic review and training suitability not assessed'});
 await api('/collections/'+c.id,{revision:1,members:[{episode_id:episode.id,interval:null}]},'PATCH');
 const version=await api('/collections/'+c.id+'/versions',{revision:2,review_ids:[]});const exported=await job((await api('/collection-versions/'+version.id+'/exports',{})).id);
 const manifest=await (await fetch(base+'/api/v1/artifacts/'+exported.result.artifacts.find((a:any)=>a.kind==='manifest.json').id)).json();assert.deepEqual(manifest.collection,version.collection);assert.deepEqual(manifest.episodes[0].annotations,episode.annotations);assert.equal(manifest.reviews.length,0);
 const timings:number[]=[];for(let i=0;i<20;i++){const t=performance.now();await api('/queries',{text:'makingCoffee',source_id:source.id});timings.push(performance.now()-t);}timings.sort((a,b)=>a-b);
 const report={status:'passed',fixture:false,revision:BOTFAILS_REVISION,task:episode.task,source_episode:episode.source_episode,frames:episode.frames,views:episode.streams.length,findings:episode.findings,upstream_verification:source.plan.verification,host:{platform:os.platform(),cpu:os.cpus()[0].model,node:process.version},measurements:{selected_bytes:source.plan.estimated_bytes,import_ms:importMs,first_preview_ms:previewMs,warm_query_p50_ms:timings[9],warm_query_p95_ms:timings[18],worker_lifetime_peak_rss_bytes:imported.metrics.worker_lifetime_peak_rss_bytes,derived_directory_bytes:bytes(store.directory)},limitations:['One real episode; not representative corpus scale','No human judgments or policy training','OS caches were not flushed; first access is not a certified cold-cache measurement'],retained_data_directory:root};
 writeFileSync('artifacts/curation/public-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser?.close();if(worker.exitCode===null){worker.kill();await once(worker,'exit');}await new Promise<void>(r=>server.close(()=>r()));store.close();}
