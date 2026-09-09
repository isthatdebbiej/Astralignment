import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {once} from 'node:events';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import {Store} from '../../gateway/curation/store.js';
import {createCurationApp} from '../../gateway/curation/app.js';
import {WorkerSupervisor} from '../../gateway/curation/supervisor.js';

async function until(predicate:()=>boolean){const end=Date.now()+10000;while(!predicate()){if(Date.now()>end)throw new Error('Timed out');await new Promise(r=>setTimeout(r,25));}}
function directory(){mkdirSync('runtime',{recursive:true});return mkdtempSync(path.resolve('runtime/qualification-'));}

test('GET filters, stream bounds and stale publication preserve the reviewed selection',async()=>{
 const root=directory();mkdirSync(path.join(root,'sources'));const store=new Store(path.join(root,'data'));
 store.put('source','source',{id:'source',project_id:'default',revision:'fixture'});
 for(const [id,split] of [['a','test'],['b','normal_train']]){
  const e={id,source_id:'source',source_episode:id,family_id:id,task:id,split,origin:'fixture',robot:null,duration:20,frames:600,task_text:[],channels:[],annotations:[],findings:[],
   artifacts:[{id:'artifact',path:'synthetic',sha256:'fixture',bytes:1,kind:'video'}],
   streams:[{id:'verified',artifact_id:'artifact',kind:'video',timing:'fixture',bounds:{frames:30,seconds:1}},{id:'unknown',artifact_id:'artifact',kind:'video',timing:'unknown'}]};
  store.put('episode',id,e);store.index(e,'default');
 }
 const server=createCurationApp(store,path.join(root,'sources'),'fixture').listen(0,'127.0.0.1');await once(server,'listening');
 const base='http://127.0.0.1:'+(server.address() as any).port+'/api/v1';
 async function call(route:string,body?:unknown,method=body?'POST':'GET'){const response=await fetch(base+route,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json()};}
 try{
  assert.deepEqual((await call('/episodes?split=test&limit=1')).data.episodes.map((e:any)=>e.id),['a']);
  assert.equal((await call('/episodes?project_id=nonexistent')).data.total,0);
  assert.equal((await call('/episodes?unsupported_filter=x')).status,400);
  const review={role:'failure',rationale:'Synthetic bound test',evidence:['artifact']};
  assert.equal((await call('/episodes/a/reviews',{...review,interval:{stream_id:'unknown',unit:'frames',start:0,end:1}})).status,400);
  assert.equal((await call('/episodes/a/reviews',{...review,interval:{stream_id:'verified',unit:'frames',start:0,end:31}})).status,400);
  assert.equal((await call('/episodes/a/reviews',{...review,interval:{stream_id:'verified',unit:'seconds',start:0,end:2}})).status,400);
  assert.equal((await call('/episodes/a/reviews',{...review,interval:{stream_id:'verified',unit:'frames',start:0,end:30}})).status,201);
  const c=(await call('/projects/default/collections',{name:'Fixture',intended_use:'test'})).data;
  await call('/collections/'+c.id,{revision:1,members:[{episode_id:'a',interval:null}]},'PATCH');
  await call('/collections/'+c.id,{revision:2,members:[{episode_id:'b',interval:null}]},'PATCH');
  assert.equal((await call('/collections/'+c.id+'/versions',{revision:2,review_ids:[]})).status,409);
  assert.equal(store.count('version'),0);
  const v=(await call('/collections/'+c.id+'/versions',{revision:3,review_ids:[]})).data;
  assert.equal(v.collection.members[0].episode_id,'b');
 }finally{await new Promise<void>(r=>server.close(()=>r()));store.close();}
});

test('native worker restarts after a real process exit, then stops without respawning',async()=>{
 const root=directory(),marker=path.join(root,'starts.json');
 const script=`const fs=require('fs');const p=process.argv[1];let ids=[];try{ids=JSON.parse(fs.readFileSync(p))}catch{}ids.push(process.pid);fs.writeFileSync(p,JSON.stringify(ids));if(ids.length===1)process.exit(7);setInterval(()=>{},1000);`;
 const supervisor=new WorkerSupervisor(process.execPath,['-e',script,marker],process.env,20,2);
 supervisor.start();
 try{await until(()=>{try{return JSON.parse(readFileSync(marker,'utf8')).length===2;}catch{return false;}});assert.equal(supervisor.state.restart_count,1);}
 finally{await supervisor.stop();}
 await new Promise(r=>setTimeout(r,100));assert.equal(JSON.parse(readFileSync(marker,'utf8')).length,2);assert.equal(supervisor.state.status,'stopped');
});

test('worker spawn failures exhaust bounded retries and support explicit retry',async()=>{
 const supervisor=new WorkerSupervisor(path.join(directory(),'missing-python'),[],process.env,10,1);
 supervisor.start();try{await until(()=>supervisor.state.status==='failed');assert.equal(supervisor.state.can_restart,true);supervisor.restart();await until(()=>supervisor.state.status==='failed');}finally{await supervisor.stop();}
});

test('OS-killed metadata writer reopens committed records and reconciles leases without a worker',async()=>{
 const root=directory(),data=path.join(root,'data');
 const module=new URL('../../gateway/curation/store.ts',import.meta.url).href;
 const script=`import(${JSON.stringify(module)}).then(({Store})=>{const s=new Store(process.argv[1]);s.put('review','saved',{id:'saved',rationale:'committed synthetic review'});s.put('job','lost',{id:'lost',status:'running',attempt:1,updated_at:'2000-01-01T00:00:00Z'});console.log('committed');setInterval(()=>{},1000);});`;
 const child=spawn(process.execPath,['--import','tsx','-e',script,data],{stdio:['ignore','pipe','pipe'],windowsHide:true});
 const exited=once(child,'exit');let output='';child.stdout.on('data',b=>{output+=b;});
 try{await until(()=>output.includes('committed'));}finally{child.kill();await exited;}
 const restored=new Store(data);try{assert.equal(restored.get<any>('review','saved').rationale,'committed synthetic review');restored.reconcileJobs();assert.equal(restored.get<any>('job','lost').status,'queued');assert.equal(restored.get<any>('job','lost').history[0].status,'lease-expired');}finally{restored.close();}
});

test('native API termination stops its worker and restart preserves collections',{timeout:30000},async()=>{
 const root=directory();const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=(reservation.address() as any).port;await new Promise<void>(r=>reservation.close(()=>r()));
 const env={...process.env,CURATION_DATA_DIR:path.join(root,'data'),CURATION_SOURCE_ROOT:path.join(root,'sources'),CURATION_PORT:String(port),CURATION_AUTO_WORKER:'1',CURATION_PUBLIC_ORIGIN:'',CURATION_WORKER_TOKEN:'native-lifecycle-fixture'};
 function launch(){return spawn(process.execPath,['--import','tsx','gateway/curation/server.ts'],{env,stdio:'ignore',windowsHide:true});}
 let apiProcess=launch();let workerPid:number|undefined;
 async function ready(){const deadline=Date.now()+10000;while(Date.now()<deadline){try{const r=await fetch(`http://127.0.0.1:${port}/api/v1/settings`);const s=await r.json();if(s.worker.status==='available'){workerPid=s.worker.pid;return;}}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('Native API did not start');}
 async function killApi(){const exit=once(apiProcess,'exit');apiProcess.kill();await exit;if(workerPid)await until(()=>{try{process.kill(workerPid!,0);return false;}catch{return true;}});}
 try{
  await ready();assert.ok(workerPid);
  const c=await (await fetch(`http://127.0.0.1:${port}/api/v1/projects/default/collections`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Survive API termination',intended_use:'synthetic persistence test'})})).json();
  const baseline=path.join(root,'smoke.json');
  const smoke=spawnSync(process.env.CURATION_PYTHON??'python',['worker/smoke_curation.py','--api',`http://127.0.0.1:${port}`,'--record',baseline],{encoding:'utf8',timeout:10000});assert.equal(smoke.status,0,smoke.stderr);
  await killApi();apiProcess=launch();await ready();
  const reopened=await (await fetch(`http://127.0.0.1:${port}/api/v1/collections/${c.id}`)).json();assert.equal(reopened.name,c.name);
  const compared=spawnSync(process.env.CURATION_PYTHON??'python',['worker/smoke_curation.py','--api',`http://127.0.0.1:${port}`,'--compare',baseline],{encoding:'utf8',timeout:10000});assert.equal(compared.status,0,compared.stderr);
 }finally{if(apiProcess.exitCode===null)await killApi();}
});
