import express from 'express';
import { z } from 'zod';
import { realpathSync, statSync,statfsSync } from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import { curationAccess } from './access.js';
import { artifactVerifier } from './artifacts.js';
import { Store, id, now } from './store.js';
import { BOTFAILS_REVISION, REVIEW_ROLES, type Episode, type Collection, type Job } from '../../contracts/curation.js';

const intervalSchema=z.object({stream_id:z.string(),start:z.number().nonnegative(),end:z.number().positive(),unit:z.enum(['seconds','frames'])});
const memberSchema=z.object({episode_id:z.string(),interval:intervalSchema.nullable().default(null)});
export function contained(root:string,relative:string) {
  if(path.isAbsolute(relative))throw new Error('Absolute paths are not allowed');
  const base=realpathSync(root), resolved=realpathSync(path.resolve(base,relative.replaceAll('\\','/')));
  const rel=path.relative(base,resolved);
  if(rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))throw new Error('Path escapes source root');
  return resolved;
}
export function createCurationApp(store:Store, sourceRoot:string, workerToken:string,controls?:{state:()=>{status:string;message:string;can_restart:boolean;pid?:number|null};restart:()=>void}) {
  const app=express(); app.disable('x-powered-by'); app.use(express.json({limit:'2mb'}));
  app.use('/api/v1',curationAccess(workerToken));
  let lastWorkerContact=0;
  app.use('/api/v1/internal',(_q,_r,next)=>{lastWorkerContact=Date.now();next();});
  const workerHealth=()=>{
    const native=controls?.state();const recent=Date.now()-lastWorkerContact<30000;
    const available=recent&&(!native||native.status==='running');
    return {status:available?'available':native?.status==='running'?'unavailable':native?.status??'unavailable',
      message:available?'CPU worker is responding.':native?.message??'No recent worker contact. Start the worker service; committed data remains available.',
      last_contact:lastWorkerContact?new Date(lastWorkerContact).toISOString():null,can_restart:native?.can_restart??false,pid:native?.pid??null};
  };
  app.post('/api/v1/worker/restart',(_q,r)=>{if(!controls)throw new Error('Restart the externally managed worker service');controls.restart();r.json(workerHealth());});
  const verifyArtifact=artifactVerifier();
  function required(kind:string,key:string) {const item=store.get(kind,key);if(!item)throw Object.assign(new Error('Resource not found'),{status:404});return item;}
  function job(kind:Job['kind'],payload:Record<string,unknown>) {
    if(store.activeJobs().length>=16)throw new Error('Worker queue is full');
    const j:Job={id:id(),kind,payload,status:'queued',stage:'queued',progress:0,attempt:0,created_at:now(),updated_at:now(),error:null,result:null};
    store.put('job',j.id,j);return j;
  }
  function validateMember(m:any) {
    const e=required('episode',m.episode_id) as Episode;
    if(m.interval) {
      const i=m.interval,stream=e.streams.find(s=>s.id===i.stream_id);
      const bound=i.unit==='frames'?stream?.bounds?.frames:stream?.bounds?.seconds;
      if(bound==null||i.start>=i.end||i.end>bound)throw new Error('Invalid or unverified stream interval bounds; reinspect older sources to verify media');
      if(i.unit==='frames'&&(!Number.isInteger(i.start)||!Number.isInteger(i.end)))throw new Error('Frame bounds must be integers');
    }return e;
  }
  const pagination=(query:unknown)=>z.object({offset:z.coerce.number().int().nonnegative().default(0),limit:z.coerce.number().int().min(1).max(100).default(40)}).parse(query);
  app.get('/api/v1/projects',(q,r)=>{const p=pagination(q.query);r.json(store.page('project',p.limit,p.offset));});
  app.post('/api/v1/projects',(q,r)=>{const data=z.object({name:z.string().trim().min(1).max(120)}).parse(q.body);const p={id:id(),...data,created_at:now()};store.put('project',p.id,p);r.status(201).json(p);});
  app.get('/api/v1/settings',(_q,r)=>r.json({schema_version:'1.0.0',cpu_worker_count:1,metadata_limit_bytes:store.metadataLimit,
    export_limit_bytes:Number(process.env.CURATION_EXPORT_MAX_BYTES??1073741824),import_limit_bytes:Number(process.env.CURATION_MAX_IMPORT_BYTES??21474836480),
    metadata_file_bytes:statSync(path.join(store.directory,'curation.sqlite')).size,
    filesystem_available_bytes:Number(statfsSync(store.directory).bavail)*Number(statfsSync(store.directory).bsize),
    models_required:false,worker:workerHealth(),backup:'Cold backup: worker/backup.py; stop both services first; choose an explicit destination',remote_auth_configured:!!process.env.CURATION_PUBLIC_ORIGIN}));
  app.get('/api/v1/evaluation-state',(q,r)=>{
    const project=String(q.query.project_id??'default');required('project',project);
    const fingerprint=createHash('sha256');let episodes=0;
    const sources=store.db.prepare("SELECT id,data FROM records WHERE kind='source' AND json_extract(data,'$.project_id')=? ORDER BY id").all(project);
    const revisions:Record<string,string>={};
    for(const source of sources){
      fingerprint.update(String(source.data));revisions[String(source.id)]=JSON.parse(String(source.data)).revision;
      for(const e of store.db.prepare("SELECT id,data FROM records WHERE kind='episode' AND json_extract(data,'$.source_id')=? ORDER BY id").iterate(source.id)){
        fingerprint.update(String(e.data));episodes++;
        for(const review of store.db.prepare("SELECT data FROM records WHERE kind='review' AND json_extract(data,'$.episode_id')=? ORDER BY id").iterate(e.id))fingerprint.update(String(review.data));
      }
    }
    r.json({project_id:project,corpus_fingerprint:fingerprint.digest('hex'),source_revisions:revisions,episodes,search_version:'fts5-0.3.0',protocols:['metadata','annotations']});
  });
  const sourceSummary=(source:any)=>{
    const counts=store.db.prepare("SELECT count(*) AS imported,coalesce(sum(json_array_length(data,'$.findings')>0),0) AS with_findings FROM records WHERE kind='episode' AND json_extract(data,'$.source_id')=?").get(source.id);
    return {...source,quality:{planned:source.plan?.episodes.length??null,imported:Number(counts?.imported??0),with_findings:Number(counts?.with_findings??0)}};
  };
  app.get('/api/v1/sources',(q,r)=>{const p=pagination(q.query);r.setHeader('X-Total-Count',store.count('source'));r.json((q.query.project_id?store.matching('source','project_id',String(q.query.project_id),p.limit,p.offset):store.page('source',p.limit,p.offset)).map(sourceSummary));});
  app.post('/api/v1/projects/:project/sources',(q,r)=>{
    required('project',q.params.project);
    const data=z.object({name:z.string().min(1).max(120),snapshot:z.string().min(1),revision:z.literal(BOTFAILS_REVISION),
      tasks:z.array(z.string().regex(/^(test|normal_train)\/[a-zA-Z0-9_-]+$/)).min(1).max(20),
      episode_indices:z.array(z.number().int().nonnegative()).min(1).max(1000).optional(),
      license:z.string().min(1).max(200),origin:z.enum(['public recording','fixture']).default('public recording')}).parse(q.body);
    contained(sourceRoot,data.snapshot);
    const duplicate=store.all<any>('source').find(s=>s.project_id===q.params.project&&s.snapshot===data.snapshot&&s.revision===data.revision&&JSON.stringify(s.tasks)===JSON.stringify(data.tasks)&&JSON.stringify(s.episode_indices??null)===JSON.stringify(data.episode_indices??null));
    if(duplicate)return r.json(duplicate);
    const s={...data,id:id(),project_id:q.params.project,status:'preflight',created_at:now(),
      revision_verification:'Operator-supplied revision; local hashes do not certify upstream snapshot identity',adapter_version:'botfails-v2-preview-0.1'};
    store.transaction(()=>{store.put('source',s.id,s);job('preflight',{source:s});});r.status(201).json(s);
  });
  app.get('/api/v1/sources/:id',(q,r)=>r.json(required('source',q.params.id)));
  app.post('/api/v1/sources/:id/revisions',(q,r)=>{
    const previous=required('source',q.params.id);
    const {plan,...identity}=previous;
    const source={...identity,id:id(),supersedes:previous.id,status:'preflight',created_at:now()};
    store.transaction(()=>{store.put('source',source.id,source);job('preflight',{source});});
    r.status(201).json(source);
  });
  app.post('/api/v1/sources/:id/imports',(q,r)=>{
    const s=required('source',q.params.id);
    if(!s.plan)throw new Error('Complete preflight before import');
    if(q.body.confirm_bytes!==s.plan.estimated_bytes)throw new Error('Confirm the current selected-file byte estimate');
    const existing=store.all<Job>('job').find(j=>j.kind==='import'&&(j.payload.source as any)?.id===s.id&&['queued','running'].includes(j.status));
    r.status(202).json(existing??job('import',{source:s}));
  });
  const search=(body:any)=>{
    const b=z.object({text:z.string().max(200).default(''),mode:z.enum(['metadata','annotations']).default('metadata'),
      project_id:z.string().optional(),source_id:z.string().optional(),task:z.string().optional(),split:z.string().optional(),
      robot:z.string().optional(),modality:z.string().optional(),source_label:z.string().optional(),
      reviewed_role:z.enum(REVIEW_ROLES).optional(),integrity:z.enum(['findings','no-findings']).optional(),
      sort:z.enum(['relevance','task','split']).default('relevance'),
      offset:z.coerce.number().int().nonnegative().default(0),limit:z.coerce.number().int().min(1).max(100).default(40)}).strict().parse(body);
    const terms=b.text.match(/[\p{L}\p{N}_-]+/gu)??[];
    let sql='SELECT id FROM episode_index WHERE 1=1'; const args:any[]=[];let ftsQuery:string|undefined;
    for(const key of ['project_id','source_id','task','split'] as const)if(b[key]){sql+=' AND '+key+'=?';args.push(b[key]);}
    if(b.robot){sql+=" AND id IN (SELECT id FROM records WHERE kind='episode' AND json_extract(data,'$.robot')=?)";args.push(b.robot);}
    if(b.modality){sql+=" AND id IN (SELECT r.id FROM records r,json_each(r.data,'$.channels') c WHERE r.kind='episode' AND c.value=? UNION SELECT r.id FROM records r,json_each(r.data,'$.streams') s WHERE r.kind='episode' AND json_extract(s.value,'$.kind')=?)";args.push(b.modality,b.modality);}
    if(b.source_label){sql+=" AND id IN (SELECT r.id FROM records r,json_each(r.data,'$.annotations') a WHERE r.kind='episode' AND json_extract(a.value,'$.label')=?)";args.push(b.source_label);}
    if(b.reviewed_role){sql+=" AND id IN (SELECT json_extract(r.data,'$.episode_id') FROM records r WHERE r.kind='review' AND json_extract(r.data,'$.role')=? AND NOT EXISTS (SELECT 1 FROM records successor WHERE successor.kind='review' AND json_extract(successor.data,'$.supersedes')=r.id))";args.push(b.reviewed_role);}
    if(b.integrity)sql+=" AND id IN (SELECT id FROM records WHERE kind='episode' AND json_array_length(data,'$.findings')"+(b.integrity==='findings'?'>0':'=0')+")";
    if(terms.length){ftsQuery=(b.mode==='metadata'?'metadata':'{metadata annotations}')+' : '+terms.map(t=>'"'+t+'"').join(' AND ');sql+=' AND id IN (SELECT id FROM episode_fts WHERE episode_fts MATCH ?)';args.push(ftsQuery);}
    const total=Number(store.db.prepare('SELECT count(*) AS n FROM ('+sql+')').get(...args)?.n??0);
    if(b.sort==='task'||b.sort==='split')sql+=' ORDER BY '+b.sort+',id';
    else if(ftsQuery){sql+=' ORDER BY (SELECT rank FROM episode_fts WHERE episode_fts MATCH ? AND episode_fts.id=episode_index.id),id';args.push(ftsQuery);}else sql+=' ORDER BY id';
    sql+=' LIMIT ? OFFSET ?';args.push(b.limit,b.offset);
    return {mode:b.mode,disclosure:b.mode==='metadata'?'Task identifier, robot and split only. Not label-hidden prediction.':'Includes source task text, annotations and reviewer labels.',
      total,offset:b.offset,limit:b.limit,sort:b.sort,coverage:'Only committed indexed episodes are searched. Pending/unimported files and video content are not searched.',annotation_filters_used:!!(b.source_label||b.reviewed_role),
      episodes:store.db.prepare(sql).all(...args).map(row=>{
        const e=required('episode',String(row.id));
        const indexed=store.db.prepare('SELECT metadata,annotations FROM episode_index WHERE id=?').get(e.id);
        const normalize=(value:unknown)=>String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
        const reasons=[];
        if(terms.some(term=>normalize(indexed?.metadata).includes(normalize(term))))reasons.push('Matched task, robot or split metadata');
        if(b.mode==='annotations'&&terms.some(term=>normalize(indexed?.annotations).includes(normalize(term))))reasons.push('Matched source annotations or review history');
        if(b.source_label||b.reviewed_role)reasons.push('Applied annotation-dependent filters');
        if(!terms.length)reasons.push('Matched structured filters');
        return {...e,match_reasons:reasons,latest_review:store.matching('review','episode_id',e.id,1)[0]};
      })};
  };
  app.post('/api/v1/queries',(q,r)=>r.json(search(q.body)));
  app.get('/api/v1/episodes',(q,r)=>r.json(search(q.query)));
  app.get('/api/v1/episodes/:id',(q,r)=>{const e=required('episode',q.params.id),s=required('source',e.source_id);r.json({...e,source_summary:{name:s.name,revision:s.revision,license:s.license,verification:s.plan?.verification??null},reviews:store.all<any>('review').filter(v=>v.episode_id===q.params.id)});});
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
    store.transaction(()=>{store.put('review',review.id,review);store.index(e,required('source',e.source_id).project_id,store.all<any>('review').filter(v=>v.episode_id===e.id).map(v=>v.role+' '+v.rationale).join(' '));});
    r.status(201).json(review);
  });
  app.get('/api/v1/collections',(q,r)=>{const p=pagination(q.query);r.setHeader('X-Total-Count',store.count('collection'));r.json(q.query.project_id?store.matching('collection','project_id',String(q.query.project_id),p.limit,p.offset):store.page('collection',p.limit,p.offset));});
  app.post('/api/v1/projects/:project/collections',(q,r)=>{
    required('project',q.params.project);
    const data=z.object({name:z.string().min(1).max(120),intended_use:z.string().min(1).max(2000)}).parse(q.body);
    const c:Collection={...data,id:id(),project_id:q.params.project,members:[],exclusions:[],selection:{},revision:1,created_at:now()};
    store.put('collection',c.id,c);r.status(201).json(c);
  });
  app.get('/api/v1/collections/:id',(q,r)=>{
    const c=required('collection',q.params.id) as Collection;
    const ids=new Set(c.members.map(m=>m.episode_id));
    const p=pagination({offset:q.query.version_offset,limit:20});
    const versions=store.db.prepare("SELECT id,json_extract(data,'$.created_at') AS created_at,json_extract(data,'$.collection.revision') AS collection_revision,json_array_length(data,'$.collection.members') AS member_count FROM records WHERE kind='version' AND json_extract(data,'$.collection_id')=? ORDER BY rowid DESC LIMIT ? OFFSET ?").all(c.id,p.limit,p.offset);
    r.json({...c,versions,
      episodes:[...ids].map(e=>required('episode',e)),
      reviews:store.all<any>('review').filter(review=>ids.has(review.episode_id))});
  });
  app.get('/api/v1/collections/:id/versions',(q,r)=>{required('collection',q.params.id);const p=pagination(q.query);r.json(store.matching('version','collection_id',q.params.id,p.limit,p.offset));});
  app.patch('/api/v1/collections/:id',(q,r)=>{
    const c=required('collection',q.params.id);
    const b=z.object({revision:z.number().int(),name:z.string().trim().min(1).max(120).optional(),
      selection:z.record(z.string(),z.unknown()).optional(),intended_use:z.string().trim().min(1).max(2000).optional(),members:z.array(memberSchema).max(1000),
      exclusions:z.array(z.object({episode_id:z.string(),reason:z.string().trim().min(1).max(2000)})).max(1000).default([])}).parse(q.body);
    if(c.revision!==b.revision)throw Object.assign(new Error('Collection changed; reload before saving'),{status:409});
    b.members.forEach(validateMember);
    for(const member of b.members){
      const episode=required('episode',member.episode_id),source=required('source',episode.source_id);
      if(source.project_id!==c.project_id)throw new Error('Collection and episode must belong to the same project');
    }
    b.exclusions.forEach(e=>required('episode',e.episode_id));
    if(new Set(b.exclusions.map(e=>e.episode_id)).size!==b.exclusions.length)throw new Error('Duplicate exclusion');
    if(new Set(b.members.map(m=>JSON.stringify(m))).size!==b.members.length)throw new Error('Duplicate selection');
    if(b.exclusions.some(x=>b.members.some(m=>m.episode_id===x.episode_id)))throw new Error('An episode cannot be included and excluded');
    const updated={...c,...b,revision:c.revision+1};store.put('collection',c.id,updated);r.json(updated);
  });
  app.post('/api/v1/collections/:id/versions',(q,r)=>{
    const expected=z.object({revision:z.number().int().positive(),review_ids:z.array(z.string()).max(10000)}).strict().parse(q.body);
    const published=store.transaction(()=>{
    const c=required('collection',q.params.id) as Collection;
    if(c.revision!==expected.revision)throw Object.assign(new Error('Collection changed; reload and review before publishing'),{status:409});
    if(!c.members.length)throw new Error('Select at least one episode');
    const episodes=[...new Set(c.members.map(m=>m.episode_id))].map(e=>required('episode',e));
    const reviews=store.all<any>('review').filter(v=>episodes.some(e=>e.id===v.episode_id));
    if(JSON.stringify(reviews.map(v=>v.id).sort())!==JSON.stringify([...expected.review_ids].sort()))throw Object.assign(new Error('Reviews changed; reload and review before publishing'),{status:409});
    const families=new Map<string,string>();
    for(const e of episodes){if(families.has(e.family_id)&&families.get(e.family_id)!==e.id)throw new Error('The same source family appears through multiple source revisions');families.set(e.family_id,e.id);}
    c.members.forEach(validateMember);
    const sources=[...new Set(episodes.map(e=>e.source_id))].map(s=>{
      const source=required('source',s);
      if(!source.plan)return source;
      const selectedPaths=new Set(episodes.filter(e=>e.source_id===s).flatMap(e=>e.artifacts.map((a:any)=>a.path)));
      const files=source.plan.files.filter((f:any)=>selectedPaths.has(f.path)||f.path.replaceAll('\\','/').includes('/meta/')||f.path.endsWith('.curation-upstream.json'));
      return {...source,full_manifest_sha256:createHash('sha256').update(JSON.stringify(source.plan)).digest('hex'),
        selection_only:true,plan:{...source.plan,files,episodes:[],estimated_bytes:files.reduce((sum:number,f:any)=>sum+f.bytes,0)}};
    });
    const v={id:id(),collection_id:c.id,created_at:now(),schema_version:'1.0.0',collection:c,episodes,sources,
      reviews,
      integrity:episodes.some(e=>e.findings.length)?'findings present':'import checks passed',
      training_suitability:'unknown',measured_training_benefit:'not evaluated'};
    if(Buffer.byteLength(JSON.stringify(v))>8*1024*1024)throw new Error('Collection snapshot exceeds the 8 MiB admission limit; select fewer episodes');
    store.put('version',v.id,v);return v;
    });r.status(201).json(published);
  });
  app.get('/api/v1/collection-versions/:id',(q,r)=>r.json(required('version',q.params.id)));
  app.get('/api/v1/collection-versions/:id/compare/:other',(q,r)=>{
    const left=required('version',q.params.id),right=required('version',q.params.other);
    if(left.collection_id!==right.collection_id)throw new Error('Compare versions from the same collection');
    const key=(m:any)=>JSON.stringify(m);
    const a=new Set(left.collection.members.map(key)),b=new Set(right.collection.members.map(key));
    r.json({from:left.id,to:right.id,added:right.collection.members.filter((m:any)=>!a.has(key(m))),
      removed:left.collection.members.filter((m:any)=>!b.has(key(m))),
      reviews_added:right.reviews.filter((review:any)=>!left.reviews.some((old:any)=>old.id===review.id)),
      exclusions:{from:left.collection.exclusions,to:right.collection.exclusions},
      intended_use:{from:left.collection.intended_use,to:right.collection.intended_use}});
  });
  app.post('/api/v1/collection-versions/:id/exports',(q,r)=>r.status(202).json(job('export',{version:required('version',q.params.id)})));
  app.get('/api/v1/jobs',(q,r)=>{const p=pagination(q.query);r.setHeader('X-Total-Count',store.count('job'));r.json(store.page<any>('job',p.limit,p.offset).map(({payload,...j})=>({...j,payload:{},result:j.kind==='export'?j.result:null})));});
  app.get('/api/v1/jobs/:id',(q,r)=>r.json(required('job',q.params.id)));
  app.post('/api/v1/jobs/:id/cancel',(q,r)=>{const j=required('job',q.params.id);if(['queued','running'].includes(j.status)){j.status='cancelled';j.updated_at=now();store.put('job',j.id,j);}r.json(j);});
  app.post('/api/v1/jobs/:id/retry',(q,r)=>{const j=required('job',q.params.id);if(!['failed','cancelled'].includes(j.status))throw new Error('Job is not retryable');j.status='queued';j.error=null;store.put('job',j.id,j);r.json(j);});
  app.get('/api/v1/artifacts/:id',async(q,r)=>{
    const a=required('artifact',q.params.id);
    const filename=contained(a.export?store.directory:sourceRoot,a.path);
    await verifyArtifact(filename,a);
    const type=a.kind.startsWith('observation.images.')?'video/mp4':a.kind==='manifest.json'||a.kind.startsWith('source metadata:')?'application/json':a.kind==='source annotation'?'text/plain; charset=utf-8':a.kind==='annotations.jsonl'?'application/x-ndjson':'application/octet-stream';
    r.sendFile(filename,{acceptRanges:true,dotfiles:'deny',headers:{'Content-Type':type,'Cache-Control':'private, no-cache','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'"}});
  });
  app.post('/api/v1/internal/claim',(_q,r)=>{
    store.reconcileJobs();
    const jobs=store.activeJobs();
    if(jobs.some(j=>j.status==='running'))return r.status(204).end();
    const j=jobs.find(j=>j.status==='queued');
    if(!j)return r.status(204).end();
    j.status='running';j.attempt++;j.updated_at=now();
    j.history=[...(j.history??[]),{attempt:j.attempt,status:'started',at:j.updated_at}];
    store.put('job',j.id,j);r.json(j);
  });
  app.post('/api/v1/internal/jobs/:id',(q,r)=>{
    const j=required('job',q.params.id);
    if(j.status!=='running'||q.body.attempt!==j.attempt)return r.status(409).json({error:'Job lease is no longer valid'});
    z.object({attempt:z.number().int().positive(),stage:z.string().max(500).optional(),
      progress:z.number().min(0).max(1).optional(),status:z.enum(['completed','failed']).optional(),
      error:z.string().max(8000).optional(),episode:z.unknown().optional(),result:z.unknown().optional(),
      metrics:z.object({elapsed_seconds:z.number().nonnegative(),worker_lifetime_peak_rss_bytes:z.number().int().nonnegative().nullable()}).strict().optional()}).strict().parse(q.body);
    if(q.body.status==='completed'){
      const file=z.object({path:z.string().min(1),bytes:z.number().int().nonnegative(),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
      if(j.kind==='preflight'){
        const result=z.object({estimated_bytes:z.number().int().nonnegative(),files:z.array(file).max(20000),
          episodes:z.array(z.object({index:z.number().int().nonnegative(),task:z.string(),info:z.record(z.string(),z.unknown()),
            row:z.record(z.string(),z.unknown()),findings:z.array(z.string()).optional(),files:z.array(z.object({kind:z.string(),path:z.string()}).strict()).max(64)}).strict()).max(1000),
          findings:z.array(z.string()).max(20000),verification:z.object({mode:z.enum(['local-only','upstream-hashes-verified']),receipt_sha256:z.string().optional(),verified_at:z.string().optional()}).strict().optional()}).strict().parse(q.body.result);
        if(result.files.reduce((n,f)=>n+f.bytes,0)!==result.estimated_bytes)throw new Error('Invalid preflight byte estimate');
        if(new Set(result.files.map(f=>f.path)).size!==result.files.length)throw new Error('Duplicate source artifact');
        if(result.episodes.some(e=>!j.payload.source.tasks.includes(e.task)))throw new Error('Unrequested task in worker result');
        for(const f of result.files)if(statSync(contained(sourceRoot,f.path)).size!==f.bytes)throw new Error('Source changed during preflight');
      }else if(j.kind==='preview'){
        const result=z.object({episode_id:z.literal(j.payload.episode_id),artifact_sha256:z.literal(j.payload.artifact.sha256),
          offset:z.literal(j.payload.offset),columns:z.array(z.enum(['timestamp','frame_index','action','observation.state'])).max(4),
          rows:z.array(z.record(z.string(),z.unknown())).max(j.payload.limit),timing:z.string().max(1000),
          video_references:z.array(z.array(z.object({kind:z.string(),path:z.string(),timestamp:z.number().nonnegative()}).strict()).max(32)).max(j.payload.limit).optional()}).strict().parse(q.body.result);
        if(result.rows.some(row=>Object.keys(row).some(key=>!result.columns.includes(key as any))))throw new Error('Unexpected preview channel');
      }else if(j.kind==='import'){
        const result=z.object({episodes:z.number().int().nonnegative()}).strict().parse(q.body.result);
        if(result.episodes!==j.payload.source.plan.episodes.length)throw new Error('Incomplete import count');
      }else if(j.kind==='export'){
        const result=z.object({annotation_count:z.number().int().nonnegative(),artifacts:z.array(file.extend({id:z.string().min(1),kind:z.enum(['manifest.json','annotations.jsonl','annotations.parquet'])})).length(3)}).strict().parse(q.body.result);
        if(new Set(result.artifacts.map(a=>a.kind)).size!==3)throw new Error('Missing export format');
        for(const a of result.artifacts){
          if(a.path.replaceAll('\\','/')!=='exports/'+j.id+'/'+a.kind)throw new Error('Invalid export destination');
          if(statSync(contained(store.directory,a.path)).size!==a.bytes)throw new Error('Export artifact changed before publication');
        }
      }
    }
    if(q.body.episode){
      if(j.kind!=='import')throw new Error('Only import jobs may publish episodes');
      const artifact=z.object({id:z.string().min(1),path:z.string().min(1),sha256:z.string().regex(/^[a-f0-9]{64}$/),
        bytes:z.number().int().nonnegative(),kind:z.string().min(1)}).strict();
      const e=z.object({id:z.string().min(1),source_id:z.literal(j.payload.source.id),source_episode:z.string(),family_id:z.string().min(1),
        task:z.string(),split:z.enum(['test','normal_train']),origin:z.enum(['public recording','fixture']),robot:z.string().nullable(),
        duration:z.number().positive().nullable(),fps:z.number().positive().nullable(),frames:z.number().int().positive(),
        upstream_splits:z.record(z.string(),z.string()),task_text:z.array(z.string()),channels:z.array(z.string()),
        artifacts:z.array(artifact).max(64),streams:z.array(z.object({id:z.string(),kind:z.string(),artifact_id:z.string(),timing:z.string(),bounds:z.object({frames:z.number().int().positive().nullable(),seconds:z.number().positive().nullable()}).strict().optional()}).strict()).max(32),
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
      if(q.body.metrics)j.metrics=q.body.metrics;
      if(q.body.episode){const e=q.body.episode;store.put('episode',e.id,e);store.index(e,required('source',e.source_id).project_id,store.all<any>('review').filter(v=>v.episode_id===e.id).map(v=>v.role+' '+v.rationale).join(' '));for(const a of e.artifacts)store.put('artifact',a.id,a);}
      if(q.body.status==='failed'){j.status='failed';j.error=String(q.body.error);}
      if(q.body.status==='completed'){
        j.status='completed';j.result=q.body.result;j.progress=1;
        if(j.kind==='preflight'){const s=required('source',j.payload.source.id);s.plan=j.result;s.status='ready';store.put('source',s.id,s);}
        if(j.kind==='import'){const s=required('source',j.payload.source.id);s.status='imported';store.put('source',s.id,s);}
        if(j.kind==='export')for(const a of j.result.artifacts)store.put('artifact',a.id,{...a,export:true});
      }
      if(q.body.status)j.history=[...(j.history??[]),{attempt:j.attempt,status:j.status,at:j.updated_at,error:j.error}];
      store.put('job',j.id,j);
    });r.json(j);
  });
  app.use((error:any,_q:any,r:any,_n:any)=>r.status(error.status??400).json({error:error.message??'Request failed'}));
  return app;
}
