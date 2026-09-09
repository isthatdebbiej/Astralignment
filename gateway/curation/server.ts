import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import { Store } from './store.js';
import { createCurationApp } from './app.js';
import {WorkerSupervisor} from './supervisor.js';
const directory=path.resolve(process.env.CURATION_DATA_DIR??'runtime/curation');
const sources=path.resolve(process.env.CURATION_SOURCE_ROOT??'runtime/sources');
mkdirSync(sources,{recursive:true});
const token=process.env.CURATION_WORKER_TOKEN??randomBytes(32).toString('hex');
const store=new Store(directory);
let worker:WorkerSupervisor|undefined;
const native=process.env.CURATION_AUTO_WORKER!=='0';
const app=createCurationApp(store,sources,token,native?{state:()=>worker?.state??{status:'starting',message:'Starting CPU worker',can_restart:false},restart:()=>worker?.restart()}:undefined);
app.use(express.static(path.resolve('dist')));
app.get('/curation',(_q,r)=>r.sendFile(path.resolve('dist/index.html')));
const port=Number(process.env.CURATION_PORT??8788);
const server=app.listen(port,process.env.CURATION_CONTAINER_LOCAL==='1'?'0.0.0.0':'127.0.0.1',()=>console.log('Curation API: http://127.0.0.1:'+port+'/curation'));
if(native){
  worker=new WorkerSupervisor(process.env.CURATION_PYTHON??'python',['worker/curation.py'],{...process.env,
    CURATION_WORKER_TOKEN:token,CURATION_API:'http://127.0.0.1:'+port,CURATION_SOURCE_ROOT:sources,CURATION_DATA_DIR:directory,CURATION_PARENT_PIPE:'1'});
  worker.start();
}
const reconcile=setInterval(()=>{try{store.reconcileJobs();}catch(e){console.error('Lease reconciliation failed:',e);}},5000);
let stopping=false;
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{if(stopping)return;stopping=true;clearInterval(reconcile);void (async()=>{await worker?.stop();server.close(()=>{store.close();process.exit(0);});})();});
