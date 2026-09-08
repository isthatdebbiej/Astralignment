import express from 'express';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import httpProxy from 'http-proxy';
import { WebSocket, WebSocketServer } from 'ws';
import { z } from 'zod';
import { DEFAULT_SCENE, type CameraCalibration, type EvaluationResult, type GatewayEvent, type SceneConfig, type SearchResult, type WorldSnapshot } from '../contracts/index';
import { registerCamera } from './camera';
import { authorized, operatorOnly, registerAuth } from './auth';
import { MODEL, astraAccess, repairFailure, probeAstra, type FailureContext } from './astra';
import { evaluateSource, sim } from './sim-client';
import { artifacts, budget, initializeStore } from './store';
import { observeStage, observationInput } from './observe';
import { assertArtifactOrigin } from './evidence';
import { recordExperiment, listExperiments, readExperiment, exportExperimentMcap } from './recordings';
import { registerPerception } from './perception';

await initializeStore();
const app = express();
app.disable('x-powered-by');
const server = createServer(app);
const events = new WebSocketServer({noServer:true,maxPayload:1024});
const eventHistory: GatewayEvent[] = [];
function emit(event: Omit<GatewayEvent,'at'>) {
  // Immutable compact trace snapshots: don't retain mutable artifact references or
  // resend megabytes of body frames on every status event. Full results use HTTP.
  const next:GatewayEvent = JSON.parse(JSON.stringify({...event,at:new Date().toISOString()},(key,value)=>key==='frames'?[]:value));
  eventHistory.push(next); if (eventHistory.length > 100) eventHistory.shift();
  const json = JSON.stringify(next);
  for (const client of events.clients) if (client.readyState === WebSocket.OPEN && client.bufferedAmount < 2e6) client.send(json);
}
let failure: FailureContext | undefined;
let calibration: CameraCalibration | undefined;
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
  if (!/^\/(health|scene|state|model|controller|dimos\/status|random-scene|reset|run|pause|resume|invalidate|step|commands|checkpoint|fork|evaluate|branch\/[a-zA-Z0-9-]+(?:\/step|\/result)?|assets\/(?:meshes\/[a-zA-Z0-9_.-]+\.STL|LICENSE|provenance\.json))$/.test(req.path)) return res.status(404).json({error:'Unknown simulation route'});
  proxy.web(req,res);
});
app.use(express.json({limit:'6mb'}));
registerAuth(app);
app.use('/api',(req,res,next)=>{
  // A paired phone needs ICE configuration; camera module validates its own session.
  if (req.path === '/camera/config') return next();
  return operatorOnly(req,res,next);
});
registerPerception(app,()=>sim<SceneConfig>('/scene'));
registerCamera(app,server,{onCalibration:async confirmedCalibration=>{
  if(confirmedCalibration.width<3||confirmedCalibration.width>30||confirmedCalibration.depth<3||confirmedCalibration.depth>30) throw new Error('Measured stage dimensions must be between 3 and 30 meters');
  const stage:SceneConfig=structuredClone(DEFAULT_SCENE);
  stage.width=confirmedCalibration.width;stage.depth=confirmedCalibration.depth;
  stage.robots[0].spawn=[-stage.width*.25,0,0];stage.robots[0].goal=[stage.width*.25,0];
  stage.robots[1].spawn=[0,-stage.depth*.3,Math.PI/2];stage.robots[1].goal=[0,Math.min(stage.depth*.25,stage.depth*.36-.55)];
  stage.keepouts=[{id:'presenter',polygon:[[-stage.width*.47,stage.depth*.36],[stage.width*.47,stage.depth*.36],[stage.width*.47,stage.depth*.47],[-stage.width*.47,stage.depth*.47]]}];
  job?.abort.abort(new Error('Measured scene changed')); failure=undefined;
  await sim('/reset',{scene:stage});
  calibration=confirmedCalibration;
  emit({type:'scene_invalidated',message:'Measured stage geometry confirmed. Prior branch results no longer apply.'});
}});
const obstacleInput=z.object({
  confirmed:z.literal(true),scene_epoch:z.number().int().positive(),episode_id:z.string().uuid(),captured_at:z.string(),
  obstacle:z.object({id:z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),position:z.tuple([z.number().finite(),z.number().finite()]),size:z.tuple([z.number().positive().max(10),z.number().positive().max(10),z.number().positive().max(10)])}).strict(),
}).strict();
app.post('/api/world/obstacles',async(req,res)=>{
  const input=obstacleInput.parse(req.body);
  if(!calibration || input.captured_at!==calibration.captured_at) return res.status(409).json({error:'Floor calibration is missing or changed. Reconfirm it before changing the physics world.'});
  const scene=await sim<SceneConfig>('/scene');
  if(Math.abs(scene.width-calibration.width)>.001||Math.abs(scene.depth-calibration.depth)>.001) return res.status(409).json({error:'World dimensions changed after camera calibration. Recalibrate.'});
  const next={...scene,obstacles:[...scene.obstacles.filter(o=>o.id!==input.obstacle.id),input.obstacle]};
  const state=await sim<WorldSnapshot>('/reset',{scene:next,expected_scene_epoch:input.scene_epoch,expected_episode_id:input.episode_id});
  job?.abort.abort(new Error('Human confirmed a physical scene change'));failure=undefined;
  emit({type:'scene_invalidated',message:`Human-confirmed ${input.obstacle.id} grounded in the measured floor. Physics reset; previous evidence invalidated.`,data:{scene_epoch:state.scene_epoch,obstacle:input.obstacle,calibration_time:calibration.captured_at}});
  res.json({state,scene:next,provenance:'human-confirmed planar footprint and height; not automatic 3D reconstruction'});
});
app.post('/api/world/obstacles/remove',async(req,res)=>{
  const input=z.object({id:z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),scene_epoch:z.number().int().positive(),episode_id:z.string().uuid(),confirmed:z.literal(true)}).strict().parse(req.body);
  const scene=await sim<SceneConfig>('/scene');
  if(!scene.obstacles.some(o=>o.id===input.id)) return res.status(404).json({error:'Obstacle not found'});
  const next={...scene,obstacles:scene.obstacles.filter(o=>o.id!==input.id)};
  const state=await sim<WorldSnapshot>('/reset',{scene:next,expected_scene_epoch:input.scene_epoch,expected_episode_id:input.episode_id});
  job?.abort.abort(new Error('Human removed an obstacle'));failure=undefined;
  emit({type:'scene_invalidated',message:`Human-confirmed removal of ${input.id}. Previous evidence invalidated.`,data:{scene_epoch:state.scene_epoch}});
  res.json({state,scene:next});
});
app.get('/api/health',async(_req,res)=>{
  let physics:unknown;
  try { const response=await fetch((process.env.SIM_URL||'http://127.0.0.1:8001')+'/health',{signal:AbortSignal.timeout(2000)});physics=response.ok?await response.json():{ok:false,error:`HTTP ${response.status}`}; } catch {physics={ok:false,error:'Physics service is offline'};}
  res.json({status:'online',model:MODEL,api_key_present:!!process.env.OPENAI_API_KEY,astra_access:astraAccess,sim:physics,budget,job:job?.name||null,sandbox:'QuickJS/WASM worker; no host capabilities',camera:'WebRTC; device check required'});
});
app.get('/api/artifacts',(_req,res)=>res.json({artifacts:[...artifacts.values()].reverse()}));
app.get('/api/experiments',async(_req,res)=>res.json({experiments:await listExperiments()}));
app.get('/api/experiments/:file',async(req,res)=>{
  const match=/^([0-9a-f-]{36})\.(json|mcap)$/.exec(req.params.file);
  if(!match) return res.status(400).json({error:'Invalid experiment filename'});
  const [file,id,format]=match;
  res.setHeader('Content-Disposition',`attachment; filename="${file}"`);
  if(format==='mcap') return res.type('application/octet-stream').send(Buffer.from(await exportExperimentMcap(id)));
  return res.json(await readExperiment(id));
});
app.get('/api/events',(_req,res)=>res.json({events:eventHistory}));
app.get('/api/controller',async(_req,res)=>res.json(await sim('/controller')));
// DimOS is a separate native robotics service, never loaded into the policy runtime.
for (const endpoint of ['health', 'state'] as const) app.get(`/api/dimos/${endpoint}`, async (_req,res) => {
  if (!process.env.DIMOS_URL) return res.status(503).json({ok:false,error:'DimOS service is not configured'});
  try {
    const response = await fetch(`${process.env.DIMOS_URL}/${endpoint}`, {signal:AbortSignal.timeout(3000)});
    return res.status(response.status).json(await response.json());
  } catch { return res.status(503).json({ok:false,error:'DimOS service is unavailable'}); }
});
app.post('/api/probe',async(_req,res)=>res.json(await exclusive('Astra access check',()=>probeAstra())));
app.post('/api/observe',async(req,res)=>{
  const input=observationInput.parse(req.body);
  if(!calibration||input.calibration_at!==calibration.captured_at) return res.status(409).json({error:'Confirm the current measured floor before asking Astra to inspect the stage.'});
  const state=await sim<WorldSnapshot>('/state');
  if(state.scene_epoch!==input.scene_epoch||state.episode_id!==input.episode_id) return res.status(409).json({error:'The scene changed after frame capture. Capture a new still.'});
  const scene=await sim<SceneConfig>('/scene');
  const result=await exclusive('Astra stage observation',signal=>observeStage(input,calibration!,scene,signal));
  const after=await sim<WorldSnapshot>('/state');
  if(after.scene_epoch!==input.scene_epoch||after.episode_id!==input.episode_id) return res.status(409).json({error:'The scene changed during observation. Proposals are stale and were not applied.'});
  emit({type:'status',message:'Astra inspected the selected camera still. Proposed geometry requires human review.',data:{model:result.model,frame_hash:result.frame_hash,scene_epoch:result.scene_epoch}});
  res.json(result);
});
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
      const checkpoint=await sim<{checkpoint_id:string,scene_epoch:number,episode_id:string}>('/checkpoint',{});
      emit({type:'search',message:`Evaluating independent baseline, seed ${scene.seed} (${i+1}/${options.trials}).`});
      const evaluation=await sim<EvaluationResult>('/evaluate',{checkpoint_id:checkpoint.checkpoint_id,mode:'independent',duration:options.duration});
      await recordExperiment('baseline',{scene,checkpoint,evaluation});
      signal.throwIfAborted();
      const found=!evaluation.passed;
      last={found,trials:i+1,seed:scene.seed,scene,evaluation,message:found?`Measured failure: ${evaluation.reason}`:'No failure found in the tested trajectories.'};
      if (found) {failure={scene,checkpoint_id:checkpoint.checkpoint_id,scene_epoch:checkpoint.scene_epoch,episode_id:checkpoint.episode_id,evaluation};break;}
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
  if (state.scene_epoch!==failure.scene_epoch || state.episode_id!==failure.episode_id) return res.status(409).json({error:'The scene changed or simulation restarted. Find a fresh counterexample before repairing.'});
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
  assertArtifactOrigin(artifact,await sim<WorldSnapshot>('/state'));
  if (!failure || artifact.scene_epoch!==failure.scene_epoch || artifact.origin_episode_id!==failure.episode_id) return res.status(409).json({error:'Frozen original checkpoint unavailable or stale. Run a fresh search and repair.'});
  const evaluation=await exclusive('Frozen-source replay',signal=>evaluateSource(artifact.source,failure!.scene,{checkpoint_id:failure!.checkpoint_id,duration:30,signal}));
  await recordExperiment('replay',{repair_id:artifact.id,source:artifact.source,source_hash:artifact.source_hash,scene:failure!.scene,evaluation});
  res.json(evaluation);
});
app.post('/api/heldout',async(req,res)=>{
  const artifact=selectedArtifact(req.body);
  assertArtifactOrigin(artifact,await sim<WorldSnapshot>('/state'));
  const trials=Number(req.body?.trials||3);
  const results=await exclusive('Held-out spawn evaluation',async signal=>{
    const scene=await sim<SceneConfig>('/scene');
    const evaluations:EvaluationResult[]=[];
    for (let i=0;i<trials;i++) {
      signal.throwIfAborted();
      assertArtifactOrigin(artifact,await sim<WorldSnapshot>('/state'));
      const seed=(scene.seed+104729*(i+1))%2147483647;
      const heldout=await sim<SceneConfig>(`/random-scene?seed=${seed}`);
      const evaluation=await evaluateSource(artifact.source,heldout,{duration:30,signal});
      await recordExperiment('heldout',{repair_id:artifact.id,source:artifact.source,source_hash:artifact.source_hash,scene:heldout,evaluation});
      evaluations.push(evaluation);
      emit({type:'status',message:`Frozen source ${artifact.source_hash.slice(0,8)}: held-out ${i+1}/${trials} ${evaluation.passed?'passed':'failed'} — ${evaluation.reason}`});
    }
    assertArtifactOrigin(artifact,await sim<WorldSnapshot>('/state'));
    return {policy_hash:artifact.source_hash,origin_episode_id:artifact.origin_episode_id,scene_epoch:artifact.scene_epoch,trials,passed:evaluations.filter(e=>e.passed).length,results:evaluations,scope:'Previously untested seeded spawns, same measured stage; not a safety certificate'};
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
