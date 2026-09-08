import express from 'express';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import httpProxy from 'http-proxy';
import { WebSocket, WebSocketServer } from 'ws';
import { z } from 'zod';
import { DEFAULT_SCENE, type EvaluationResult, type GatewayEvent, type SceneConfig, type SearchResult, type WorldSnapshot } from '../contracts/index';
import { registerCamera } from './camera';
import { authorized, operatorOnly, registerAuth } from './auth';
import { MODEL, astraAccess, repairFailure, probeAstra, type FailureContext } from './astra';
import { evaluateSource, sim } from './sim-client';
import { artifacts, budget, initializeStore } from './store';

await initializeStore();
const app = express();
app.disable('x-powered-by');
const server = createServer(app);
const events = new WebSocketServer({noServer:true,maxPayload:1024});
const eventHistory: GatewayEvent[] = [];
function emit(event: Omit<GatewayEvent,'at'>) {
  const next = {...event,at:new Date().toISOString()};
  eventHistory.push(next); if (eventHistory.length > 100) eventHistory.shift();
  const json = JSON.stringify(next);
  for (const client of events.clients) if (client.readyState === WebSocket.OPEN && client.bufferedAmount < 2e6) client.send(json);
}
let failure: FailureContext | undefined;
let job: {name:string,abort:AbortController} | undefined;
async function exclusive<T>(name:string, action:(signal:AbortSignal)=>Promise<T>):Promise<T> {
  if (job) throw Object.assign(new Error(`${job.name} is already running`),{status:409});
  job={name,abort:new AbortController()};
  emit({type:'status',message:`${name} started.`});
  try { return await action(job.abort.signal); } finally { job=undefined; }
}
app.use((_req,res,next)=>{res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');next();});
// Proxy before JSON parsing so request bodies reach FastAPI unchanged.
const proxy = httpProxy.createProxyServer({target:process.env.SIM_URL||'http://127.0.0.1:8001',ws:true});
proxy.on('error',(_error,_req,res)=>{
  if ('writeHead' in res && !res.headersSent) res.writeHead(503,{'Content-Type':'application/json'}).end(JSON.stringify({error:'Physics service unavailable. Start python -m sim.server on port 8001.'}));
});
app.use('/api/sim',operatorOnly,(req,res)=>{
  if (!/^\/(health|scene|state|model|controller|random-scene|reset|run|pause|resume|invalidate|step|commands|checkpoint|fork|evaluate|branch\/[a-zA-Z0-9-]+(?:\/step|\/result)?|assets\/(?:meshes\/[a-zA-Z0-9_.-]+\.STL|LICENSE|provenance\.json))$/.test(req.path)) return res.status(404).json({error:'Unknown simulation route'});
  proxy.web(req,res);
});
app.use(express.json({limit:'6mb'}));
registerAuth(app);
app.use('/api',(req,res,next)=>{
  // A paired phone needs ICE configuration; camera module validates its own session.
  if (req.path === '/camera/config') return next();
  return operatorOnly(req,res,next);
});
registerCamera(app,server,{onCalibration:async calibration=>{
  const stage:SceneConfig=structuredClone(DEFAULT_SCENE);
  stage.width=calibration.width;stage.depth=calibration.depth;
  stage.robots[0].spawn=[-stage.width*.25,0,0];stage.robots[0].goal=[stage.width*.25,0];
  stage.robots[1].spawn=[0,-stage.depth*.3,Math.PI/2];stage.robots[1].goal=[0,stage.depth*.25];
  stage.keepouts=[{id:'presenter',polygon:[[-stage.width*.47,stage.depth*.36],[stage.width*.47,stage.depth*.36],[stage.width*.47,stage.depth*.47],[-stage.width*.47,stage.depth*.47]]}];
  job?.abort.abort(new Error('Measured scene changed')); failure=undefined;
  await sim('/reset',{scene:stage});
  emit({type:'scene_invalidated',message:'Measured stage geometry confirmed. Prior branch results no longer apply.'});
}});
app.get('/api/health',async(_req,res)=>{
  let physics:unknown;
  try { const response=await fetch((process.env.SIM_URL||'http://127.0.0.1:8001')+'/health',{signal:AbortSignal.timeout(2000)});physics=response.ok?await response.json():{ok:false,error:`HTTP ${response.status}`}; } catch {physics={ok:false,error:'Physics service is offline'};}
  res.json({status:'online',model:MODEL,api_key_present:!!process.env.OPENAI_API_KEY,astra_access:astraAccess,sim:physics,budget,job:job?.name||null,sandbox:'QuickJS/WASM worker; no host capabilities',camera:'WebRTC; device check required'});
});
app.get('/api/artifacts',(_req,res)=>res.json({artifacts:[...artifacts.values()].reverse()}));
app.get('/api/events',(_req,res)=>res.json({events:eventHistory}));
app.get('/api/controller',async(_req,res)=>res.json(await sim('/controller')));
app.post('/api/probe',async(_req,res)=>res.json(await exclusive('Astra access check',()=>probeAstra())));
app.post('/api/cancel',(_req,res)=>{job?.abort.abort(new Error('Cancelled by operator'));res.json({ok:true});});

const searchInput=z.object({trials:z.number().int().min(1).max(12).default(4),duration:z.number().min(5).max(30).default(30)}).strict();
app.post('/api/search',async(req,res)=>{
  const options=searchInput.parse(req.body||{});
  const result=await exclusive('Counterexample search',async signal=>{
    failure=undefined;
    await sim('/pause',{});
    const original=await sim<SceneConfig>('/scene');
    let last:SearchResult|undefined;
    for (let i=0;i<options.trials;i++) {
      signal.throwIfAborted();
      const seed=original.seed+i;
      await sim('/reset',i===0?{scene:original}:{scene:original,seed});
      const scene=await sim<SceneConfig>('/scene');
      const checkpoint=await sim<{checkpoint_id:string,scene_epoch:number}>('/checkpoint',{});
      emit({type:'search',message:`Evaluating independent baseline, seed ${scene.seed} (${i+1}/${options.trials}).`});
      const evaluation=await sim<EvaluationResult>('/evaluate',{checkpoint_id:checkpoint.checkpoint_id,mode:'independent',duration:options.duration});
      signal.throwIfAborted();
      const found=!evaluation.passed;
      last={found,trials:i+1,seed:scene.seed,scene,evaluation,message:found?`Measured failure: ${evaluation.reason}`:'No failure found in the tested trajectories.'};
      if (found) {failure={scene,checkpoint_id:checkpoint.checkpoint_id,scene_epoch:checkpoint.scene_epoch,evaluation};break;}
    }
    emit({type:'search',message:last!.message,data:last});
    return last!;
  });
  res.json(result);
});
app.post('/api/repair',async(req,res)=>{
  const mission=z.object({mission:z.string().max(1000).optional()}).strict().parse(req.body||{}).mission || 'Both robots reach their marks while keeping presenter access open.';
  if (!failure) return res.status(409).json({error:'Find a measured counterexample first; no canned failure will be substituted.'});
  const state=await sim<WorldSnapshot>('/state');
  if (state.scene_epoch!==failure.scene_epoch) return res.status(409).json({error:'The scene changed. Find a fresh counterexample before repairing.'});
  res.json(await exclusive('Astra executable repair',signal=>repairFailure(failure!,mission,emit,signal)));
});
function selectedArtifact(body:unknown) {
  const id=z.object({repair_id:z.string().optional(),trials:z.number().int().min(1).max(8).optional()}).strict().parse(body||{}).repair_id;
  const artifact=id?artifacts.get(id):[...artifacts.values()].reverse().find(a=>a.source&&a.status==='passed');
  if (!artifact?.source) throw Object.assign(new Error('No executable repair selected'),{status:409});
  return artifact;
}
app.post('/api/replay',async(req,res)=>{
  const artifact=selectedArtifact(req.body);
  if (!failure || artifact.scene_epoch!==failure.scene_epoch) return res.status(409).json({error:'Frozen original checkpoint unavailable or stale. Run a fresh search and repair.'});
  res.json(await exclusive('Frozen-source replay',signal=>evaluateSource(artifact.source,failure!.scene,{checkpoint_id:failure!.checkpoint_id,duration:30,signal})));
});
app.post('/api/heldout',async(req,res)=>{
  const artifact=selectedArtifact(req.body);
  const trials=Number(req.body?.trials||3);
  const results=await exclusive('Held-out spawn evaluation',async signal=>{
    const scene=await sim<SceneConfig>('/scene');
    const evaluations:EvaluationResult[]=[];
    for (let i=0;i<trials;i++) {
      signal.throwIfAborted();
      const seed=(scene.seed+104729*(i+1))%2147483647;
      const heldout=await sim<SceneConfig>(`/random-scene?seed=${seed}`);
      const evaluation=await evaluateSource(artifact.source,heldout,{duration:30,signal});
      evaluations.push(evaluation);
      emit({type:'status',message:`Frozen source ${artifact.source_hash.slice(0,8)}: held-out ${i+1}/${trials} ${evaluation.passed?'passed':'failed'} — ${evaluation.reason}`});
    }
    return {policy_hash:artifact.source_hash,trials,passed:evaluations.filter(e=>e.passed).length,results:evaluations,scope:'Previously untested seeded spawns, same measured stage; not a safety certificate'};
  });
  res.json(results);
});
server.on('upgrade',(req,socket,head)=>{
  const url=new URL(req.url||'/','http://localhost');
  if (url.pathname==='/ws/camera') return;
  if (!authorized(req)) {socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');socket.destroy();return;}
  if (url.pathname==='/ws/state') {req.url='/ws/state';proxy.ws(req,socket,head);}
  else if(url.pathname==='/ws/events') events.handleUpgrade(req,socket,head,ws=>{events.emit('connection',ws,req);});
  else socket.destroy();
});
if (existsSync(path.resolve('dist'))) {
  app.use(express.static(path.resolve('dist')));
  app.get('/{*path}',(_req,res)=>res.sendFile(path.resolve('dist/index.html')));
}
app.use((error:Error & {status?:number},_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
  const status=error instanceof z.ZodError?400:error.status||500;
  const message=error.message.slice(0,1500);
  emit({type:'error',message});res.status(status).json({error:message});
});
const port=Number(process.env.PORT||8787);
const host=process.env.HOST||'127.0.0.1';
if (host!=='127.0.0.1' && host!=='localhost' && (!process.env.PUBLIC_ORIGIN || !process.env.ASTRA_OPERATOR_TOKEN)) throw new Error('Public binding requires PUBLIC_ORIGIN and ASTRA_OPERATOR_TOKEN');
server.listen(port,host,()=>console.log(`Astralignment gateway http://${host}:${port}; model ${MODEL}; API key ${process.env.OPENAI_API_KEY?'present':'absent'}`));
for (const sig of ['SIGINT','SIGTERM'] as const) process.on(sig,()=>{job?.abort.abort();for(const ws of events.clients)ws.close();proxy.close();server.close(()=>process.exit(0));});
