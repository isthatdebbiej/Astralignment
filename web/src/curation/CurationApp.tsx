import React, {useEffect,useState} from 'react';
import type {Source,Episode,Collection,Job} from '../../../contracts/curation';
import {BOTFAILS_REVISION,REVIEW_ROLES} from '../../../contracts/curation';
import './curation.css';
import {CollectionEditor,EpisodeSelection} from './CollectionEditor';
import {StateInspector} from './StateInspector';
async function api(url:string,body?:unknown,method=body?'POST':'GET'){
 const response=await fetch('/api/v1'+url,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 const data=await response.json();if(!response.ok)throw new Error(data.error);return data;
}
export default function CurationApp(){
 const [page,setPage]=useState<'library'|'collections'>('library');
 const [sources,setSources]=useState<Source[]>([]),[episodes,setEpisodes]=useState<Episode[]>([]);
 const [collections,setCollections]=useState<Collection[]>([]),[jobs,setJobs]=useState<Job[]>([]);
 const [selected,setSelected]=useState<(Episode&{reviews:any[]})|null>(null);
 const [collection,setCollection]=useState<any>(null),[text,setText]=useState(''),[mode,setMode]=useState('metadata');
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[register,setRegister]=useState(false);
 const [busy,setBusy]=useState(false),[offset,setOffset]=useState(0);
 const [destination,setDestination]=useState('');
 async function refresh(){const [s,c,j]=await Promise.all([api('/sources'),api('/collections'),api('/jobs')]);setSources(s);setCollections(c);setJobs(j);}
 async function search(start=0){const result=await api('/queries',{text,mode,offset:start});setEpisodes(result.episodes);setOffset(start);}
 async function run(fn:()=>Promise<void>){setError('');setBusy(true);try{await fn();await refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 useEffect(()=>{void run(async()=>{await search();});const timer=setInterval(()=>{void refresh().catch(e=>setError(e.message));},3000);return()=>clearInterval(timer);},[]);
 const form=(event:React.FormEvent<HTMLFormElement>)=>{event.preventDefault();return new FormData(event.currentTarget);};
 return <div className="cu-app"><aside className="cu-nav"><div className="cu-wordmark">Evidence workspace<span>LOCAL · CPU</span></div>
 <nav aria-label="Primary"><button aria-current={page==='library'?'page':undefined} onClick={()=>{setPage('library');setSelected(null);}}>Library</button>
 <button aria-current={page==='collections'?'page':undefined} onClick={()=>{setPage('collections');setSelected(null);}}>Collections</button></nav>
 <div className="cu-nav-bottom"><a href="/">Open existing prototype ↗</a><small>Evidence curation preview<br/>Training benefit: not evaluated</small></div></aside>
 <main><header><div><p className="cu-eyebrow">RECORDED EVIDENCE</p><h1>{selected?'Episode inspection':page==='library'?'Library':'Collections'}</h1></div>
 <button onClick={()=>setRegister(!register)}>Register source</button></header>
 {error&&<div role="alert" className="cu-alert">{error}<button onClick={()=>setError('')}>Dismiss</button></div>}
 {notice&&<p role="status">{notice}</p>}
 {register&&<section className="cu-panel"><h2>Register a local BotFails snapshot</h2><p>No download occurs. Select only the task folders you intend to inspect.</p>
 <form onSubmit={e=>{const f=form(e);void run(async()=>{await api('/projects/default/sources',{name:f.get('name'),snapshot:f.get('snapshot'),tasks:String(f.get('tasks')).split(',').map(s=>s.trim()),revision:BOTFAILS_REVISION,license:f.get('license')});setRegister(false);});}}>
 <div className="cu-grid"><label>Name<input name="name" required placeholder="Coffee handoffs"/></label>
 <label>Snapshot folder, relative to source root<input name="snapshot" required placeholder="BotFails-snapshot"/></label>
 <label>Task folders, comma separated<input name="tasks" required placeholder="test/domotic_makingCoffee_anomaly"/></label>
 <label>Source license reference<input name="license" required defaultValue="BotFails dataset card: Apache-2.0"/></label></div>
 <p className="cu-mono">Pinned revision {BOTFAILS_REVISION}</p><button disabled={busy}>Inspect selected files</button></form></section>}
 {selected?<section className="cu-panel"><button onClick={()=>setSelected(null)}>← Back to Library</button><h2>{selected.task} / {selected.source_episode}</h2>
 <p>{selected.split} · {selected.origin} · {selected.frames} declared frames</p>
 <EpisodeSelection key={selected.id} episode={selected} collections={collections} onChanged={refresh}/>
 <StateInspector key={'samples-'+selected.id} episode={selected}/>
 <div className="cu-videos">{selected.streams.map(s=><figure key={s.id}><video controls preload="metadata" src={'/api/v1/artifacts/'+s.artifact_id}/><figcaption>{s.kind}<br/>{s.timing}</figcaption></figure>)}</div>
 {!selected.streams.length&&<p>No recorded video available.</p>}
 <p className="cu-warning">Views play independently. Cross-stream clock relationships are unknown; visual alignment is not causal synchronization.</p>
 <details><summary>Source evidence and available channels</summary><p>Channels: {selected.channels.join(', ')||'none verified'}</p>
 <p>Original task annotations: {selected.task_text.join(' / ')}</p><p>Integrity findings: {selected.findings.join('; ')||'No import findings'}</p>
 <div className="cu-scroll"><table><thead><tr><th>Source label (unmapped)</th><th>Native frame interval</th></tr></thead><tbody>{selected.annotations.map((a,i)=><tr key={i}><td>{a.label}</td><td>[{a.start_frame}, {a.end_frame})</td></tr>)}</tbody></table></div>
 {selected.artifacts.map(a=><p key={a.id}><a href={'/api/v1/artifacts/'+a.id}>{a.kind}</a> <small>{a.bytes.toLocaleString()} bytes · SHA-256 {a.sha256.slice(0,12)}…</small></p>)}</details>
 <h3>Add a review</h3><form onSubmit={e=>{const f=form(e);void run(async()=>{
 const interval=f.get('scope')==='interval'?{stream_id:f.get('stream'),start:Number(f.get('start')),end:Number(f.get('end')),unit:'frames'}:null;
 await api('/episodes/'+selected.id+'/reviews',{role:f.get('role'),rationale:f.get('rationale'),evidence:[f.get('evidence')],interval});
 setSelected(await api('/episodes/'+selected.id));setNotice('Review saved. Earlier revisions remain available.');});}}>
 <div className="cu-grid"><label>Intended role<select name="role">{REVIEW_ROLES.map(role=><option key={role}>{role}</option>)}</select></label>
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
 <section className="cu-panel"><div className="cu-table-head"><h2>Episodes</h2><span>{episodes.length} in this page</span></div>
 <label>Add episodes to<select value={destination} onChange={e=>setDestination(e.target.value)}><option value="">Choose collection</option>{collections.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
 {!episodes.length?<div className="cu-empty"><h3>Start with a small, recorded task.</h3><p>Register a snapshot, inspect its byte estimate, then explicitly import it.</p></div>:<div className="cu-scroll"><table><thead><tr><th>Task / episode</th><th>Split</th><th>Evidence</th><th>Review</th></tr></thead><tbody>{episodes.map(e=><tr key={e.id}><td><button className="cu-link" onClick={()=>void run(async()=>setSelected(await api('/episodes/'+e.id)))}>{e.task}<small>{e.source_episode} · {e.origin}</small></button></td><td>{e.split}</td><td>{e.streams.length} views · {e.findings.length} findings</td><td><button onClick={()=>void run(async()=>{
 if(!destination)throw new Error('Choose a destination collection first.');
 const c=await api('/collections/'+destination) as Collection;if(c.members.some(m=>m.episode_id===e.id&&m.interval===null))return;
 await api('/collections/'+c.id,{revision:c.revision,members:[...c.members,{episode_id:e.id,interval:null}],exclusions:c.exclusions},'PATCH');setNotice('Added to '+c.name);})}>Add to collection</button></td></tr>)}</tbody></table></div>}
 <footer><button disabled={offset===0||busy} onClick={()=>void run(()=>search(Math.max(0,offset-40)))}>Previous</button><button disabled={episodes.length<40||busy} onClick={()=>void run(()=>search(offset+40))}>Next</button></footer></section>
 <details className="cu-panel" open={!episodes.length}><summary>Sources ({sources.length})</summary>{sources.map(s=><article key={s.id}><h3>{s.name}</h3><p>{s.status} · {s.tasks.join(', ')}</p>
 {s.plan&&<><p>{s.plan.estimated_bytes.toLocaleString()} selected bytes · {s.plan.files.length} files</p><p>{s.plan.findings.join('; ')}</p><button disabled={busy||s.plan.findings.length>0} onClick={()=>void run(async()=>{await api('/sources/'+s.id+'/imports',{confirm_bytes:s.plan!.estimated_bytes});setNotice('Import queued. Refresh search when it completes.');})}>Import this selection</button></>}</article>)}</details></>:<>
 <section className="cu-panel"><h2>Create collection</h2><form className="cu-search" onSubmit={e=>{const f=form(e);void run(async()=>{await api('/projects/default/collections',{name:f.get('name'),intended_use:f.get('use')});});}}><label>Name<input name="name" required/></label><label className="cu-grow">Intended use<input name="use" required placeholder="Review recovery examples; action suitability not yet assessed"/></label><button disabled={busy}>Create</button></form></section>
 <div className="cu-collection-list">{collections.map(c=><button key={c.id} onClick={()=>void run(async()=>setCollection(await api('/collections/'+c.id)))}><strong>{c.name}</strong><span>{c.members.length} selections · draft revision {c.revision}</span></button>)}</div>
 {collection&&<CollectionEditor key={collection.id} id={collection.id} onChanged={refresh}/>}</>}
 <details className="cu-panel"><summary>Jobs ({jobs.filter(j=>['queued','running'].includes(j.status)).length} active)</summary>{jobs.map(j=><article key={j.id}><strong>{j.kind} · {j.status}</strong><p>{j.stage} · attempt {j.attempt}</p>{j.error&&<p role="alert">{j.error}</p>}
 {['queued','running'].includes(j.status)&&<button onClick={()=>void run(async()=>{await api('/jobs/'+j.id+'/cancel',{});})}>Cancel</button>}
 {['failed','cancelled'].includes(j.status)&&<button onClick={()=>void run(async()=>{await api('/jobs/'+j.id+'/retry',{});})}>Retry</button>}
 {(j.result?.artifacts as any[]|undefined)?.map(a=><p key={a.id}><a href={'/api/v1/artifacts/'+a.id}>{a.kind}</a></p>)}</article>)}</details>
 </main></div>;
}
