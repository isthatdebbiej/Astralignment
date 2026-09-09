import React, {useEffect,useState} from 'react';
import type {Source,Episode,Collection,Job} from '../../../contracts/curation';
import {BOTFAILS_REVISION,REVIEW_ROLES} from '../../../contracts/curation';
import './curation.css';
import './preferences.css';
import {CollectionEditor,EpisodeSelection} from './CollectionEditor';
import {EpisodeEvidence} from './EpisodeEvidence';
async function api(url:string,body?:unknown,method=body?'POST':'GET'){
 const response=await fetch('/api/v1'+url,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 const data=await response.json();if(!response.ok)throw new Error(data.error);return data;
}
export default function CurationApp(){
 const [authenticated,setAuthenticated]=useState<boolean|null>(null),[error,setError]=useState('');
 useEffect(()=>{void api('/auth').then(result=>setAuthenticated(result.authenticated)).catch(e=>setError(e.message));},[]);
 if(authenticated)return <CurationWorkspace/>;
 return <main className="cu-app"><section className="cu-panel"><h1>Evidence workspace</h1>
 {authenticated===null?<p>Checking access…</p>:<form onSubmit={event=>{event.preventDefault();const form=new FormData(event.currentTarget);void api('/auth',{token:form.get('token')}).then(()=>setAuthenticated(true)).catch(e=>setError(e.message));}}>
 <label>Operator token<input name="token" type="password" autoComplete="current-password" required/></label><button>Unlock workspace</button></form>}
 {error&&<p role="alert">{error}</p>}</section></main>;
}
function CurationWorkspace(){
 const [initial]=useState(()=>new URLSearchParams(location.search));
 const [page,setPage]=useState<'library'|'collections'>(initial.get('view')==='collections'?'collections':'library');
 const [project,setProject]=useState(initial.get('project')??'default'),[projects,setProjects]=useState<{id:string;name:string}[]>([]);
 const [settings,setSettings]=useState<any>(null),[hydrated,setHydrated]=useState(false);
 const [theme,setTheme]=useState(()=>{try{return localStorage.getItem('curation-theme')??'system';}catch{return 'system';}});
 const [sourceOffset,setSourceOffset]=useState(0),[collectionOffset,setCollectionOffset]=useState(0),[jobOffset,setJobOffset]=useState(0);
 const [sources,setSources]=useState<Source[]>([]),[episodes,setEpisodes]=useState<Episode[]>([]);
 const [collections,setCollections]=useState<Collection[]>([]),[jobs,setJobs]=useState<Job[]>([]);
 const [selected,setSelected]=useState<(Episode&{reviews:any[];source_summary?:{name:string;revision:string;license:string;verification:unknown}})|null>(null);
 const [collection,setCollection]=useState<any>(null),[text,setText]=useState(initial.get('q')??''),[mode,setMode]=useState(initial.get('mode')==='annotations'?'annotations':'metadata');
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[register,setRegister]=useState(false);
 const [busy,setBusy]=useState(false),[offset,setOffset]=useState(0);
 const [destination,setDestination]=useState('');
 const [filters,setFilters]=useState<Record<string,string>>(()=>Object.fromEntries(['source_id','task','split','robot','modality','source_label','reviewed_role','integrity'].map(key=>[key,initial.get(key)??''])));
 async function refresh(){const [s,c,j]=await Promise.all([api('/sources?offset='+sourceOffset+'&project_id='+encodeURIComponent(project)),api('/collections?offset='+collectionOffset+'&project_id='+encodeURIComponent(project)),api('/jobs?offset='+jobOffset)]);setSources(s);setCollections(c);setJobs(j);}
 async function search(start=0){const result=await api('/queries',{text,mode,project_id:project,offset:start,...Object.fromEntries(Object.entries(filters).filter(([,v])=>v))});setEpisodes(result.episodes);setOffset(start);}
 async function run(fn:()=>Promise<void>){setError('');setBusy(true);try{await fn();await refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 useEffect(()=>{void run(async()=>{await search(Math.max(0,Number(initial.get('offset'))||0));setProjects(await api('/projects'));setSettings(await api('/settings'));
 if(initial.get('episode'))setSelected(await api('/episodes/'+encodeURIComponent(initial.get('episode')!)));
 if(initial.get('collection'))setCollection(await api('/collections/'+encodeURIComponent(initial.get('collection')!)));
 setHydrated(true);});},[]);
 useEffect(()=>{void refresh().catch(e=>setError(e.message));const timer=setInterval(()=>void refresh().catch(e=>setError(e.message)),3000);return()=>clearInterval(timer);},[project,sourceOffset,collectionOffset,jobOffset]);
 useEffect(()=>{document.documentElement.dataset.curationTheme=theme;try{localStorage.setItem('curation-theme',theme);}catch{}},[theme]);
 useEffect(()=>{if(!hydrated)return;const url=new URL(location.href);const previousRoute=[url.searchParams.get('view'),url.searchParams.get('episode'),url.searchParams.get('collection')].join('/');
 url.searchParams.set('view',page);url.searchParams.set('project',project);url.searchParams.set('mode',mode);url.searchParams.set('q',text);url.searchParams.set('offset',String(offset));
 for(const [key,value] of Object.entries(filters)){if(value)url.searchParams.set(key,value);else url.searchParams.delete(key);}
 if(selected)url.searchParams.set('episode',selected.id);else {url.searchParams.delete('episode');url.searchParams.delete('frame');url.searchParams.delete('stream');}
 if(collection)url.searchParams.set('collection',collection.id);else url.searchParams.delete('collection');
 const nextRoute=[url.searchParams.get('view'),url.searchParams.get('episode'),url.searchParams.get('collection')].join('/');
 if(url.href!==location.href){if(previousRoute!==nextRoute)history.pushState({},'',url);else history.replaceState({},'',url);}
 },[hydrated,page,project,text,mode,filters,offset,selected?.id,collection?.id]);
 useEffect(()=>{const restore=()=>location.reload();window.addEventListener('popstate',restore);return()=>window.removeEventListener('popstate',restore);},[]);
 const form=(event:React.FormEvent<HTMLFormElement>)=>{event.preventDefault();return new FormData(event.currentTarget);};
 return <div className="cu-app"><aside className="cu-nav"><div className="cu-wordmark">Evidence workspace<span>LOCAL · CPU</span></div>
 <nav aria-label="Primary"><button aria-current={page==='library'?'page':undefined} onClick={()=>{setPage('library');setSelected(null);}}>Library</button>
 <button aria-current={page==='collections'?'page':undefined} onClick={()=>{setPage('collections');setSelected(null);}}>Collections</button></nav>
 <div className="cu-nav-bottom"><label>Project<select value={project} onChange={e=>{const url=new URL(location.href);url.search='?project='+encodeURIComponent(e.target.value);location.assign(url);}}>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
 <details><summary>Settings</summary><label>Theme<select aria-label="Theme" value={theme} onChange={e=>setTheme(e.target.value)}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
 {settings&&<><p>CPU workers: {settings.cpu_worker_count}</p><p>Metadata limit: {(settings.metadata_limit_bytes/1048576).toFixed(0)} MiB</p><p>Export limit: {(settings.export_limit_bytes/1048576).toFixed(0)} MiB</p><p>Available filesystem: {(settings.filesystem_available_bytes/1073741824).toFixed(1)} GiB</p><small>{settings.backup}</small></>}
 <form onSubmit={e=>{const f=form(e);void run(async()=>{await api('/projects',{name:f.get('project_name')});setProjects(await api('/projects'));});}}><label>New project name<input name="project_name" required maxLength={120}/></label><button disabled={busy}>Create project</button></form></details>
 <a href="/">Open existing prototype ↗</a><small>Recorded evidence<br/>Training benefit: not evaluated</small></div></aside>
 <main><header><div><p className="cu-eyebrow">RECORDED EVIDENCE</p><h1>{selected?'Episode inspection':page==='library'?'Library':'Collections'}</h1></div>
 <button onClick={()=>setRegister(!register)}>Register source</button></header>
 {error&&<div role="alert" className="cu-alert">{error}<button onClick={()=>setError('')}>Dismiss</button></div>}
 {notice&&<p role="status">{notice}</p>}
 {register&&<section className="cu-panel"><h2>Register a local BotFails snapshot</h2><p>No download occurs. Select only the task folders you intend to inspect.</p>
 <form onSubmit={e=>{const f=form(e);void run(async()=>{await api('/projects/'+project+'/sources',{name:f.get('name'),snapshot:f.get('snapshot'),tasks:String(f.get('tasks')).split(',').map(s=>s.trim()),revision:BOTFAILS_REVISION,license:f.get('license'),origin:f.get('origin'),...(String(f.get('indices')??'').trim()?{episode_indices:String(f.get('indices')).split(',').map(s=>Number(s.trim()))}:{})});setRegister(false);});}}>
 <div className="cu-grid"><label>Name<input name="name" required placeholder="Coffee handoffs"/></label>
 <label>Recording provenance<select name="origin" defaultValue="public recording"><option value="public recording">Public recording</option><option value="fixture">Synthetic fixture</option></select></label>
 <label>Snapshot folder, relative to source root<input name="snapshot" required placeholder="BotFails-snapshot"/></label>
 <label>Task folders, comma separated<input name="tasks" required placeholder="test/domotic_makingCoffee_anomaly"/></label>
 <label>Episode indices (optional, comma separated)<input name="indices" placeholder="0, 1, 2"/></label><label>Source license reference<input name="license" required defaultValue="BotFails dataset card: Apache-2.0"/></label></div>
 <p className="cu-mono">Pinned revision {BOTFAILS_REVISION}</p><button disabled={busy}>Inspect selected files</button></form></section>}
 {selected?<section className="cu-panel"><button onClick={()=>setSelected(null)}>← Back to Library</button><h2>{selected.task} / {selected.source_episode}</h2>
 <p>{selected.split} · {selected.origin} · {selected.frames} declared frames</p>
 <EpisodeSelection key={selected.id} episode={selected} collections={collections} onChanged={refresh}/>
 <EpisodeEvidence key={'evidence-'+selected.id} episode={selected}/>
 <details><summary>Source evidence and available channels</summary><p>Channels: {selected.channels.join(', ')||'none verified'}</p>
 <p>Source: {selected.source_summary?.name} · revision {selected.source_summary?.revision}</p><p>License reference: {selected.source_summary?.license}</p><p>Upstream verification: {JSON.stringify(selected.source_summary?.verification??'Operator-supplied; not independently verified')}</p><p>Original task annotations: {selected.task_text.join(' / ')}</p><p>Integrity findings: {selected.findings.join('; ')||'No import findings'}</p>
 <div className="cu-scroll"><table><thead><tr><th>Source label (unmapped)</th><th>Native frame interval</th></tr></thead><tbody>{selected.annotations.map((a,i)=><tr key={i}><td>{a.label}</td><td>[{a.start_frame}, {a.end_frame})</td></tr>)}</tbody></table></div>
 {selected.artifacts.map(a=><p key={a.id}><a href={'/api/v1/artifacts/'+a.id}>{a.kind}</a> <small>{a.bytes.toLocaleString()} bytes · SHA-256 {a.sha256.slice(0,12)}…</small></p>)}</details>
 <h3>Add a review</h3><form onSubmit={e=>{const f=form(e);void run(async()=>{
 const interval=f.get('scope')==='interval'?{stream_id:f.get('stream'),start:Number(f.get('start')),end:Number(f.get('end')),unit:'frames'}:null;
 await api('/episodes/'+selected.id+'/reviews',{role:f.get('role'),rationale:f.get('rationale'),evidence:[f.get('evidence')],interval});
 setSelected(await api('/episodes/'+selected.id));setNotice('Review saved. Earlier revisions remain available.');});}}>
 <div className="cu-grid"><label>Intended role<select name="role" defaultValue="unknown">{REVIEW_ROLES.map(role=><option key={role}>{role}</option>)}</select></label>
 <label>Evidence artifact<select name="evidence" required>{selected.artifacts.map(a=><option key={a.id} value={a.id}>{a.kind}</option>)}</select></label>
 <label>Scope<select name="scope"><option value="episode">Whole episode</option><option value="interval">Frame interval [start, end)</option></select></label>
 <label>Reference stream<select name="stream">{selected.streams.map(s=><option key={s.id} value={s.id}>{s.kind}</option>)}</select></label>
 <label>Start frame<input name="start" type="number" min="0" defaultValue="0"/></label><label>End frame (exclusive)<input name="end" type="number" min="1" defaultValue={selected.frames}/></label></div>
 <label>Rationale<textarea name="rationale" required placeholder="What does this evidence support, and for which intended use?"/></label><button disabled={busy}>Save review</button></form>
 <details><summary>Review history ({selected.reviews.length})</summary>{selected.reviews.map(r=><article key={r.id}><strong>{r.role}</strong><p>{r.rationale}</p><small>{r.created_at} · {r.interval?'interval':'whole episode'}</small></article>)}</details>
 </section>:page==='library'?<>
 <form className="cu-search" onSubmit={e=>{e.preventDefault();void run(()=>search());}}><label className="cu-grow">Search recorded episodes<input value={text} onChange={e=>setText(e.target.value)} placeholder="Task, robot, split…"/></label>
 <label>Search fields<select value={mode} onChange={e=>setMode(e.target.value)}><option value="metadata">Metadata only</option><option value="annotations">Annotation-assisted</option></select></label><button disabled={busy}>Search</button></form>
 <p className="cu-muted">{mode==='metadata'?'Searches task identifiers, robot and split. Not label-hidden prediction.':'Includes source task text, source labels and reviewer judgments. Not automatic failure detection.'}</p>
 <details className="cu-panel"><summary>Structured filters</summary><div className="cu-grid">
 <label>Dataset source<select value={filters.source_id??''} onChange={e=>setFilters({...filters,source_id:e.target.value})}><option value="">All sources</option>{sources.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
 <label>Official split<select value={filters.split??''} onChange={e=>setFilters({...filters,split:e.target.value})}><option value="">All splits</option><option>test</option><option>normal_train</option></select></label>
 {['task','robot','modality','source_label'].map(field=><label key={field}>{field.replace('_',' ')}<input value={filters[field]??''} onChange={e=>setFilters({...filters,[field]:e.target.value})}/></label>)}
 <label>Reviewed role<select value={filters.reviewed_role??''} onChange={e=>setFilters({...filters,reviewed_role:e.target.value})}><option value="">Any role</option>{REVIEW_ROLES.map(role=><option key={role}>{role}</option>)}</select></label>
 <label>Integrity<select value={filters.integrity??''} onChange={e=>setFilters({...filters,integrity:e.target.value})}><option value="">Any findings</option><option value="findings">Findings present</option><option value="no-findings">No import findings</option></select></label>
 </div><p>Source-label and reviewed-role filters use annotations even when text search is metadata-only.</p><button onClick={()=>void run(()=>search())}>Apply filters</button></details>
 <section className="cu-panel"><div className="cu-table-head"><h2>Episodes</h2><span>{episodes.length} in this page</span></div>
 <label>Add episodes to<select value={destination} onChange={e=>setDestination(e.target.value)}><option value="">Choose collection</option>{collections.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
 {!episodes.length?<div className="cu-empty"><h3>Start with a small, recorded task.</h3><p>Register a snapshot, inspect its byte estimate, then explicitly import it.</p></div>:<div className="cu-scroll"><table><thead><tr><th>Task / episode</th><th>Split</th><th>Evidence</th><th>Review / selection</th></tr></thead><tbody>{episodes.map(e=><tr key={e.id}><td><button className="cu-link" onClick={()=>void run(async()=>setSelected(await api('/episodes/'+e.id)))}>{e.task}<small>{e.source_episode} · {e.origin}<br/>Source {e.source_id.slice(0,8)}</small></button></td><td>{e.split}</td><td>{e.streams.length} views · {e.findings.length} findings<small style={{display:'block'}}>Channels: {e.channels.join(', ')||'unavailable'}<br/>Source categories: {[...new Set(e.annotations.map(a=>a.label))].slice(0,8).join(', ')||'unknown'}<br/>{e.match_reasons?.join('; ')}</small></td><td><small style={{display:'block'}}>Latest review: {e.latest_review?e.latest_review.role+(e.latest_review.interval?' (interval)':' (episode)'):'not reviewed'}</small><button onClick={()=>void run(async()=>{
 if(!destination)throw new Error('Choose a destination collection first.');
 const c=await api('/collections/'+destination) as Collection;if(c.members.some(m=>m.episode_id===e.id&&m.interval===null))return;
 await api('/collections/'+c.id,{revision:c.revision,members:[...c.members,{episode_id:e.id,interval:null}],exclusions:c.exclusions,selection:{...c.selection,[e.id]:{text,mode,filters,selected_at:new Date().toISOString(),method:'library-search'}}},'PATCH');setNotice('Added to '+c.name);})}>Add to collection</button></td></tr>)}</tbody></table></div>}
 <footer><button disabled={offset===0||busy} onClick={()=>void run(()=>search(Math.max(0,offset-40)))}>Previous</button><button disabled={episodes.length<40||busy} onClick={()=>void run(()=>search(offset+40))}>Next</button></footer></section>
 <details className="cu-panel" open={!episodes.length}><summary>Sources ({sources.length} on this page)</summary><footer><button disabled={sourceOffset===0} onClick={()=>setSourceOffset(Math.max(0,sourceOffset-40))}>Previous sources</button><button disabled={sources.length<40} onClick={()=>setSourceOffset(sourceOffset+40)}>Next sources</button></footer>{sources.map(s=><article key={s.id}><h3>{s.name}</h3><p>{s.status} · {s.tasks.join(', ')}</p><button disabled={busy} onClick={()=>void run(async()=>{await api('/sources/'+s.id+'/revisions',{});setNotice('New source revision queued; existing evidence remains unchanged.');})}>Reinspect as new revision</button>
 {s.plan&&<><p>{s.plan.estimated_bytes.toLocaleString()} selected bytes · {s.plan.files.length} files</p><p>{s.plan.findings.join('; ')}</p><details><summary>Selected files and provenance</summary><p>Revision {s.revision}</p><p>License: {s.license}</p><p>Verification: {s.plan.verification?.mode??'local-only'}</p><p>{s.plan.episodes.length} logical episodes planned</p><ul>{s.plan.files.map(f=><li key={f.path}>{f.path} · {f.bytes} bytes</li>)}</ul></details><button disabled={busy} onClick={()=>void run(async()=>{await api('/sources/'+s.id+'/imports',{confirm_bytes:s.plan!.estimated_bytes});setNotice('Import queued. Refresh search when it completes.');})}>Import this selection</button></>}</article>)}</details></>:<>
 <section className="cu-panel"><h2>Create collection</h2><form className="cu-search" onSubmit={e=>{const f=form(e);void run(async()=>{await api('/projects/'+project+'/collections',{name:f.get('name'),intended_use:f.get('use')});});}}><label>Name<input name="name" required/></label><label className="cu-grow">Intended use<input name="use" required placeholder="Review recovery examples; action suitability not yet assessed"/></label><button disabled={busy}>Create</button></form></section>
<footer><button disabled={collectionOffset===0} onClick={()=>setCollectionOffset(Math.max(0,collectionOffset-40))}>Previous collections</button><button disabled={collections.length<40} onClick={()=>setCollectionOffset(collectionOffset+40)}>Next collections</button></footer>
 <div className="cu-collection-list">{collections.map(c=><button key={c.id} onClick={()=>void run(async()=>setCollection(await api('/collections/'+c.id)))}><strong>{c.name}</strong><span>{c.members.length} selections · draft revision {c.revision}</span></button>)}</div>
 {collection&&<CollectionEditor key={collection.id} id={collection.id} onChanged={refresh}/>}</>}
 <details className="cu-panel"><summary>Jobs ({jobs.filter(j=>['queued','running'].includes(j.status)).length} active)</summary><footer><button disabled={jobOffset===0} onClick={()=>setJobOffset(Math.max(0,jobOffset-40))}>Previous jobs</button><button disabled={jobs.length<40} onClick={()=>setJobOffset(jobOffset+40)}>Next jobs</button></footer>{jobs.map(j=><article key={j.id}><strong>{j.kind} · {j.status}</strong><p>{j.stage} · attempt {j.attempt}</p>{j.error&&<p role="alert">{j.error}</p>}
 {['queued','running'].includes(j.status)&&<button onClick={()=>void run(async()=>{await api('/jobs/'+j.id+'/cancel',{});})}>Cancel</button>}
 {['failed','cancelled'].includes(j.status)&&<button onClick={()=>void run(async()=>{await api('/jobs/'+j.id+'/retry',{});})}>Retry</button>}
 {(j.result?.artifacts as any[]|undefined)?.map(a=><p key={a.id}><a href={'/api/v1/artifacts/'+a.id}>{a.kind}</a></p>)}</article>)}</details>
 </main></div>;
}
