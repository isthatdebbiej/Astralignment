import express from 'express';
import { z } from 'zod';
import { realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { Store, id, now } from './store.js';
import { BOTFAILS_REVISION, REVIEW_ROLES, type Episode, type Collection, type Job } from '../../contracts/curation.js';

const intervalSchema=z.object({stream_id:z.string(),start:z.number().nonnegative(),end:z.number().positive(),unit:z.enum(['seconds','frames'])});
const memberSchema=z.object({episode_id:z.string(),interval:intervalSchema.nullable().default(null)});
export function contained(root:string,relative:string) {
  if(path.isAbsolute(relative))throw new Error('Absolute paths are not allowed');
  const base=realpathSync(root), resolved=realpathSync(path.resolve(base,relative));
  const rel=path.relative(base,resolved);
  if(rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))throw new Error('Path escapes source root');
  return resolved;
}
export function createCurationApp(store:Store, sourceRoot:string, workerToken:string) {
  const app=express(); app.disable('x-powered-by'); app.use(express.json({limit:'2mb'}));
  const equal=(a:string,b:string)=>Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
  app.use('/api/v1',(req,res,next)=>{
    const internal=req.path.startsWith('/internal/');
    if(internal) {
      if(!equal(req.get('authorization')??'', 'Bearer '+workerToken))return res.status(401).json({error:'Worker authentication required'});
      return next();
    }
    const local=process.env.CURATION_CONTAINER_LOCAL==='1'||['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress??'');
    const host=(req.get('host')??'').split(':')[0];
    const origin=req.get('origin');
    const localHost=['localhost','127.0.0.1','['].includes(host);
    const originOK=!origin||/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    // Remote operation is deliberately disabled until HTTPS/session integration is qualified.
    if(!local||!localHost||!originOK||qCrossSite(req.get('sec-fetch-site')))return res.status(403).json({error:'Local-only curation service'});
    next();
  });
  function required(kind:string,key:string) {const item=store.get(kind,key);if(!item)throw Object.assign(new Error('Resource not found'),{status:404});return item;}
  function job(kind:Job['kind'],payload:Record<string,unknown>) {
    if(store.all<Job>('job').filter(j=>['queued','running'].includes(j.status)).length>=16)throw new Error('Worker queue is full');
    const j:Job={id:id(),kind,payload,status:'queued',stage:'queued',progress:0,attempt:0,created_at:now(),updated_at:now(),error:null,result:null};
    store.put('job',j.id,j);return j;
  }
  function validateMember(m:any) {
    const e=required('episode',m.episode_id) as Episode;
    if(m.interval) {
      const i=m.interval,stream=e.streams.find(s=>s.id===i.stream_id);
      const bound=i.unit==='frames'?e.frames:e.duration;
      if(!stream||bound===null||i.start>=i.end||i.end>bound)throw new Error('Invalid or unverified interval bounds');
      if(i.unit==='frames'&&(!Number.isInteger(i.start)||!Number.isInteger(i.end)))throw new Error('Frame bounds must be integers');
    }return e;
  }
  app.get('/api/v1/sources',(_q,r)=>r.json(store.all('source')));
  app.post('/api/v1/projects/:project/sources',(q,r)=>{
    if(q.params.project!=='default')throw new Error('Unknown project');
    const data=z.object({name:z.string().min(1).max(120),snapshot:z.string().min(1),revision:z.literal(BOTFAILS_REVISION),
      tasks:z.array(z.string().regex(/^(test|normal_train)\/[a-zA-Z0-9_-]+$/)).min(1).max(20),
      license:z.string().min(1).max(200),origin:z.enum(['public recording','fixture']).default('public recording')}).parse(q.body);
    contained(sourceRoot,data.snapshot);
    const duplicate=store.all<any>('source').find(s=>s.snapshot===data.snapshot&&s.revision===data.revision&&JSON.stringify(s.tasks)===JSON.stringify(data.tasks));
    if(duplicate)return r.json(duplicate);
    const s={...data,id:id(),project_id:'default',status:'preflight',created_at:now(),
      revision_verification:'Operator-supplied revision; local hashes do not certify upstream snapshot identity',adapter_version:'botfails-v2-preview-0.1'};
    store.transaction(()=>{store.put('source',s.id,s);job('preflight',{source:s});});r.status(201).json(s);
  });
  app.get('/api/v1/sources/:id',(q,r)=>r.json(required('source',q.params.id)));
  app.post('/api/v1/sources/:id/imports',(q,r)=>{
    const s=required('source',q.params.id);
    if(!s.plan||s.plan.findings.length)throw new Error('Resolve preflight findings before import');
    if(q.body.confirm_bytes!==s.plan.estimated_bytes)throw new Error('Confirm the current selected-file byte estimate');
    const existing=store.all<Job>('job').find(j=>j.kind==='import'&&(j.payload.source as any)?.id===s.id&&['queued','running'].includes(j.status));
    r.status(202).json(existing??job('import',{source:s}));
  });
  const search=(body:any)=>{
    const b=z.object({text:z.string().max(200).default(''),mode:z.enum(['metadata','annotations']).default('metadata'),
      source_id:z.string().optional(),task:z.string().optional(),split:z.string().optional(),
      offset:z.number().int().nonnegative().default(0),limit:z.number().int().min(1).max(100).default(40)}).parse(body);
    const terms=b.text.match(/[\p{L}\p{N}_-]+/gu)??[];
    let sql='SELECT id FROM episode_index WHERE 1=1'; const args:any[]=[];
    for(const key of ['source_id','task','split'] as const)if(b[key]){sql+=' AND '+key+'=?';args.push(b[key]);}
    if(terms.length){sql+=' AND id IN (SELECT id FROM episode_fts WHERE episode_fts MATCH ?)';args.push((b.mode==='metadata'?'metadata':'{metadata annotations}')+' : '+terms.map(t=>'"'+t+'"').join(' AND '));}
    sql+=' ORDER BY id LIMIT ? OFFSET ?';args.push(b.limit,b.offset);
    return {mode:b.mode,disclosure:b.mode==='metadata'?'Task identifier, robot and split only. Not label-hidden prediction.':'Includes source task text, annotations and reviewer labels.',
      episodes:store.db.prepare(sql).all(...args).map(row=>required('episode',String(row.id)))};
  };
  app.post('/api/v1/queries',(q,r)=>r.json(search(q.body)));
  app.get('/api/v1/episodes',(_q,r)=>r.json(search({})));
  app.get('/api/v1/episodes/:id',(q,r)=>r.json({...required('episode',q.params.id),reviews:store.all<any>('review').filter(v=>v.episode_id===q.params.id)}));
  app.get('/api/v1/episodes/:id/intervals',(q,r)=>r.json({source:required('episode',q.params.id).annotations,reviews:store.all<any>('review').filter(v=>v.episode_id===q.params.id&&v.interval)}));
  app.post('/api/v1/episodes/:id/samples',(q,r)=>{
    const e=required('episode',q.params.id) as Episode;
    const data=z.object({offset:z.number().int().nonnegative().default(0),limit:z.number().int().min(1).max(128).default(64)}).parse(q.body);
    if(data.offset>=e.frames)throw new Error('Requested row is outside the recorded episode');
    const artifact=e.artifacts.find(a=>a.kind==='state/action');
    if(!artifact)throw new Error('No recorded state/action artifact');
    r.status(202).json(job('preview',{episode_id:e.id,artifact,...data}));
  });
  app.post('/api/v1/episodes/:id/reviews',(q,r)=>{
    const data=z.object({role:z.enum(REVIEW_ROLES),rationale:z.string().min(1).max(4000),evidence:z.array(z.string()).min(1).max(20),interval:intervalSchema.nullable().default(null)}).parse(q.body);
    const e=validateMember({episode_id:q.params.id,interval:data.interval});
    if(data.evidence.some(a=>!e.artifacts.some(v=>v.id===a)))throw new Error('Evidence must reference this episode’s registered artifacts');
    const previous=store.all<any>('review').find(v=>v.episode_id===e.id&&JSON.stringify(v.interval)===JSON.stringify(data.interval));
    const review={...data,id:id(),episode_id:e.id,created_at:now(),reviewer:'local operator',supersedes:previous?.id??null};
    store.transaction(()=>{store.put('review',review.id,review);store.index(e,'default',store.all<any>('review').filter(v=>v.episode_id===e.id).map(v=>v.role+' '+v.rationale).join(' '));});
    r.status(201).json(review);
  });
  app.get('/api/v1/collections',(_q,r)=>r.json(store.all('collection')));
  app.post('/api/v1/projects/:project/collections',(q,r)=>{
    if(q.params.project!=='default')throw new Error('Unknown project');
    const data=z.object({name:z.string().min(1).max(120),intended_use:z.string().min(1).max(2000)}).parse(q.body);
    const c:Collection={...data,id:id(),project_id:'default',members:[],exclusions:[],selection:{},revision:1,created_at:now()};
    store.put('collection',c.id,c);r.status(201).json(c);
  });
  app.get('/api/v1/collections/:id',(q,r)=>{
    const c=required('collection',q.params.id) as Collection;
    const ids=new Set(c.members.map(m=>m.episode_id));
    r.json({...c,versions:store.all<any>('version').filter(v=>v.collection_id===c.id),
      episodes:[...ids].map(e=>required('episode',e)),
      reviews:store.all<any>('review').filter(review=>ids.has(review.episode_id))});
  });
  app.patch('/api/v1/collections/:id',(q,r)=>{
    const c=required('collection',q.params.id);
    const b=z.object({revision:z.number().int(),name:z.string().trim().min(1).max(120).optional(),
      intended_use:z.string().trim().min(1).max(2000).optional(),members:z.array(memberSchema).max(1000),
      exclusions:z.array(z.object({episode_id:z.string(),reason:z.string().trim().min(1).max(2000)})).max(1000).default([])}).parse(q.body);
    if(c.revision!==b.revision)throw Object.assign(new Error('Collection changed; reload before saving'),{status:409});
    b.members.forEach(validateMember);
    b.exclusions.forEach(e=>required('episode',e.episode_id));
    if(new Set(b.exclusions.map(e=>e.episode_id)).size!==b.exclusions.length)throw new Error('Duplicate exclusion');
    if(new Set(b.members.map(m=>JSON.stringify(m))).size!==b.members.length)throw new Error('Duplicate selection');
    if(b.exclusions.some(x=>b.members.some(m=>m.episode_id===x.episode_id)))throw new Error('An episode cannot be included and excluded');
    const updated={...c,...b,revision:c.revision+1};store.put('collection',c.id,updated);r.json(updated);
  });
  app.post('/api/v1/collections/:id/versions',(q,r)=>{
    const c=required('collection',q.params.id) as Collection;
    if(!c.members.length)throw new Error('Select at least one episode');
    const episodes=[...new Set(c.members.map(m=>m.episode_id))].map(e=>required('episode',e));
    c.members.forEach(validateMember);
    const sources=[...new Set(episodes.map(e=>e.source_id))].map(s=>required('source',s));
    const v={id:id(),collection_id:c.id,created_at:now(),schema_version:'1.0.0',collection:c,episodes,sources,
      reviews:store.all<any>('review').filter(v=>episodes.some(e=>e.id===v.episode_id)),
      integrity:episodes.some(e=>e.findings.length)?'findings present':'import checks passed',
      training_suitability:'unknown',measured_training_benefit:'not evaluated'};
    store.put('version',v.id,v);r.status(201).json(v);
  });
  app.get('/api/v1/collection-versions/:id',(q,r)=>r.json(required('version',q.params.id)));
  app.post('/api/v1/collection-versions/:id/exports',(q,r)=>r.status(202).json(job('export',{version:required('version',q.params.id)})));
  app.get('/api/v1/jobs',(_q,r)=>r.json(store.all('job').slice(0,100)));
  app.get('/api/v1/jobs/:id',(q,r)=>r.json(required('job',q.params.id)));
  app.post('/api/v1/jobs/:id/cancel',(q,r)=>{const j=required('job',q.params.id);if(['queued','running'].includes(j.status)){j.status='cancelled';j.updated_at=now();store.put('job',j.id,j);}r.json(j);});
  app.post('/api/v1/jobs/:id/retry',(q,r)=>{const j=required('job',q.params.id);if(!['failed','cancelled'].includes(j.status))throw new Error('Job is not retryable');j.status='queued';j.error=null;store.put('job',j.id,j);r.json(j);});
  app.get('/api/v1/artifacts/:id',(q,r)=>{
    const a=required('artifact',q.params.id);
    const filename=contained(a.export?store.directory:sourceRoot,a.path);
    if(statSync(filename).size!==a.bytes)throw new Error('Artifact size changed; reimport required');
    r.sendFile(filename,{acceptRanges:true,dotfiles:'deny',headers:{'Cache-Control':'private, no-cache','X-Content-Type-Options':'nosniff'}});
  });
  app.post('/api/v1/internal/claim',(_q,r)=>{
    const jobs=store.all<any>('job');
    for(const j of jobs)if(j.status==='running'&&Date.now()-Date.parse(j.updated_at)>60000){j.status='queued';store.put('job',j.id,j);}
    if(jobs.some(j=>j.status==='running'))return r.status(204).end();
    const j=jobs.reverse().find(j=>j.status==='queued');
    if(!j)return r.status(204).end();
    j.status='running';j.attempt++;j.updated_at=now();store.put('job',j.id,j);r.json(j);
  });
  app.post('/api/v1/internal/jobs/:id',(q,r)=>{
    const j=required('job',q.params.id);
    if(j.status!=='running'||q.body.attempt!==j.attempt)return r.status(409).json({error:'Job lease is no longer valid'});
    z.object({attempt:z.number().int().positive(),stage:z.string().max(500).optional(),
      progress:z.number().min(0).max(1).optional(),status:z.enum(['completed','failed']).optional(),
      error:z.string().max(8000).optional(),episode:z.unknown().optional(),result:z.unknown().optional()}).strict().parse(q.body);
    if(q.body.episode){
      if(j.kind!=='import')throw new Error('Only import jobs may publish episodes');
      const artifact=z.object({id:z.string().min(1),path:z.string().min(1),sha256:z.string().regex(/^[a-f0-9]{64}$/),
        bytes:z.number().int().nonnegative(),kind:z.string().min(1)}).strict();
      const e=z.object({id:z.string().min(1),source_id:z.literal(j.payload.source.id),source_episode:z.string(),family_id:z.string().min(1),
        task:z.string(),split:z.enum(['test','normal_train']),origin:z.enum(['public recording','fixture']),robot:z.string().nullable(),
        duration:z.number().positive().nullable(),fps:z.number().positive().nullable(),frames:z.number().int().positive(),
        upstream_splits:z.record(z.string(),z.string()),task_text:z.array(z.string()),channels:z.array(z.string()),
        artifacts:z.array(artifact).max(64),streams:z.array(z.object({id:z.string(),kind:z.string(),artifact_id:z.string(),timing:z.string()}).strict()).max(32),
        annotations:z.array(z.object({label:z.string(),start_frame:z.number().int().nonnegative(),end_frame:z.number().int().positive(),evidence:z.string()}).strict()).max(100000),
        findings:z.array(z.string())}).strict().parse(q.body.episode);
      for(const a of e.artifacts){
        const planned=j.payload.source.plan.files.find((f:any)=>f.path===a.path);
        if(!planned||planned.sha256!==a.sha256||planned.bytes!==a.bytes)throw new Error('Artifact does not match approved import manifest');
      }
      if(e.streams.some(s=>!e.artifacts.some(a=>a.id===s.artifact_id))||e.annotations.some(a=>!e.artifacts.some(f=>f.id===a.evidence)))
        throw new Error('Unresolved episode evidence reference');
      const prior=store.get<Episode>('episode',e.id);
      const fingerprint=(episode:Episode)=>JSON.stringify(episode.artifacts.map(a=>[a.id,a.path,a.sha256,a.bytes,a.kind]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
      if(prior&&(prior.source_id!==e.source_id||fingerprint(prior)!==fingerprint(e)))throw new Error('Imported evidence changed; register a new source selection');
    }
    store.transaction(()=>{
      j.updated_at=now();j.stage=String(q.body.stage??j.stage);j.progress=Number(q.body.progress??j.progress);
      if(q.body.episode){const e=q.body.episode;store.put('episode',e.id,e);store.index(e,'default',store.all<any>('review').filter(v=>v.episode_id===e.id).map(v=>v.role+' '+v.rationale).join(' '));for(const a of e.artifacts)store.put('artifact',a.id,a);}
      if(q.body.status==='failed'){j.status='failed';j.error=String(q.body.error);}
      if(q.body.status==='completed'){
        j.status='completed';j.result=q.body.result;j.progress=1;
        if(j.kind==='preflight'){const s=required('source',j.payload.source.id);s.plan=j.result;s.status='ready';store.put('source',s.id,s);}
        if(j.kind==='import'){const s=required('source',j.payload.source.id);s.status='imported';store.put('source',s.id,s);}
        if(j.kind==='export')for(const a of j.result.artifacts)store.put('artifact',a.id,{...a,export:true});
      }
      store.put('job',j.id,j);
    });r.json(j);
  });
  app.use((error:any,_q:any,r:any,_n:any)=>r.status(error.status??400).json({error:error.message??'Request failed'}));
  return app;
}
function qCrossSite(value:string|undefined){return value==='cross-site';}
