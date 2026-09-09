import React,{useEffect,useState} from 'react';
import type {Collection,CollectionVersion,Episode,Review} from '../../../contracts/curation';

export async function curationApi(url:string,body?:unknown,method=body?'POST':'GET'){
 const response=await fetch('/api/v1'+url,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 const data=await response.json();if(!response.ok)throw new Error(data.error);return data;
}
type Detail=Collection&{versions:CollectionVersion[];episodes:Episode[];reviews:Review[]};
export function CollectionEditor({id,onChanged}:{id:string;onChanged:()=>Promise<void>}){
 const [data,setData]=useState<Detail|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [reason,setReason]=useState(''),[message,setMessage]=useState('');
 useEffect(()=>{let active=true;setData(null);setError('');curationApi('/collections/'+id).then(d=>{if(active)setData(d);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[id]);
 async function run(action:()=>Promise<void>){setBusy(true);setError('');try{await action();setData(await curationApi('/collections/'+id));await onChanged();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function patch(change:Partial<Collection>){if(!data)return;await curationApi('/collections/'+id,{revision:data.revision,members:data.members,exclusions:data.exclusions,...change},'PATCH');}
 if(!data)return <section className="cu-panel">{error?<p role="alert">{error}</p>:<p>Loading collection…</p>}</section>;
 const episodes=data.episodes;
 return <section className="cu-panel" aria-label="Collection editor">
 {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
 <form className="cu-search" onSubmit={event=>{event.preventDefault();const form=new FormData(event.currentTarget);void run(()=>patch({name:String(form.get('name')),intended_use:String(form.get('use'))}));}}>
 <label>Collection name<input key={data.name} name="name" defaultValue={data.name} required maxLength={120}/></label>
 <label className="cu-grow">Declared use<input key={data.intended_use} name="use" defaultValue={data.intended_use} required maxLength={2000}/></label><button disabled={busy}>Save details</button></form>
 <p>Draft revision {data.revision} · {data.members.length} selections · {new Set(episodes.map(e=>e.family_id)).size} source families</p>
 <details><summary>Evidence and training prerequisites</summary>
 <p>Integrity: {episodes.some(e=>e.findings.length)?'findings present':'no recorded import findings'}. Training suitability: unknown. Measured training benefit: not evaluated.</p>
 <ul>{episodes.some(e=>!e.channels.includes('action'))&&<li>Action channels are missing from one or more episodes.</li>}
 {episodes.some(e=>e.split==='test')&&<li>Official test episodes are included. Do not treat this selection as a training split.</li>}
 <li>Cross-stream clock relationships and intended-use compatibility require review.</li>
 <li>Check source licenses before redistribution or training.</li></ul></details>
 <h3>Membership</h3><label>Reason when excluding an episode<input value={reason} onChange={e=>setReason(e.target.value)} placeholder="Required for a recorded exclusion"/></label>
 {data.members.map((member,index)=>{const episode=episodes.find(e=>e.id===member.episode_id);return <article key={JSON.stringify(member)}>
 <strong>{episode?.task??member.episode_id} / {episode?.source_episode}</strong>
 <p>{episode?.split} · {member.interval?`[${member.interval.start}, ${member.interval.end}) ${member.interval.unit} · ${member.interval.stream_id}`:'whole episode'}</p>
 <details><summary>Review provenance and source grouping</summary><p>Family: {episode?.family_id} · Source: {episode?.source_id}</p>
 {data.reviews.filter(r=>r.episode_id===member.episode_id).map(r=><p key={r.id}>{r.role} — {r.rationale}<br/><small>{r.reviewer} · {r.created_at} · {r.supersedes?'supersedes '+r.supersedes:'initial review'}</small></p>)}</details>
 <button disabled={busy} onClick={()=>void run(()=>patch({members:data.members.filter((_,i)=>i!==index)}))}>Remove selection</button>{' '}
 <button disabled={busy||!reason.trim()} onClick={()=>void run(()=>patch({members:data.members.filter(m=>m.episode_id!==member.episode_id),exclusions:[...data.exclusions.filter(e=>e.episode_id!==member.episode_id),{episode_id:member.episode_id,reason:reason.trim()}]}))}>Exclude episode with reason</button>
 </article>;})}
 <details><summary>Exclusions ({data.exclusions.length})</summary>{data.exclusions.map(exclusion=><article key={exclusion.episode_id}><p>{exclusion.episode_id}: {exclusion.reason}</p><button disabled={busy} onClick={()=>void run(()=>patch({exclusions:data.exclusions.filter(e=>e.episode_id!==exclusion.episode_id)}))}>Clear exclusion</button></article>)}</details>
 <button disabled={busy||data.members.length===0} onClick={()=>void run(async()=>{await curationApi('/collections/'+id+'/versions',{});setMessage('Version frozen. Later draft changes do not modify it.');})}>Freeze immutable version</button>
 <h3>Published versions</h3>{data.versions.map(version=><article key={version.id}><p>{version.created_at} · {version.collection.members.length} selections · draft revision {version.collection.revision}</p>
 <a href={'/api/v1/collection-versions/'+version.id}>Inspect frozen manifest</a>{' '}
 <button disabled={busy} onClick={()=>void run(async()=>{await curationApi('/collection-versions/'+version.id+'/exports',{});setMessage('Export queued. Downloads appear in Jobs.');})}>Export selection</button></article>)}
 </section>;
}

export function EpisodeSelection({episode,collections,onChanged}:{episode:Episode;collections:Collection[];onChanged:()=>Promise<void>}){
 const [message,setMessage]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 return <details><summary>Add this episode or interval to a collection</summary>
 <form onSubmit={event=>{event.preventDefault();const form=new FormData(event.currentTarget);setBusy(true);setError('');void(async()=>{
 try{
 const collection=await curationApi('/collections/'+form.get('collection')) as Collection;
 const interval=form.get('scope')==='interval'?{stream_id:String(form.get('stream')),start:Number(form.get('start')),end:Number(form.get('end')),unit:'frames'}:null;
 const member={episode_id:episode.id,interval};
 if(collection.exclusions.some(e=>e.episode_id===episode.id))throw new Error('Clear the recorded exclusion in Collections before adding this episode.');
 await curationApi('/collections/'+collection.id,{revision:collection.revision,members:[...collection.members,member],exclusions:collection.exclusions},'PATCH');
 await onChanged();setMessage('Selection saved to '+collection.name);
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 })();}}>
 <div className="cu-grid"><label>Destination collection<select name="collection" required>{collections.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
 <label>Selection scope<select name="scope"><option value="episode">Whole episode</option><option value="interval">Frame interval</option></select></label>
 <label>Selection stream<select name="stream">{episode.streams.map(s=><option key={s.id} value={s.id}>{s.kind}</option>)}</select></label>
 <label>First frame<input name="start" type="number" min={0} step={1} defaultValue={0}/></label>
 <label>Last frame, exclusive<input name="end" type="number" min={1} step={1} defaultValue={episode.frames}/></label></div>
 <button disabled={busy||collections.length===0}>Save selection</button>
 {!collections.length&&<p>Create a collection first.</p>}{error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
 </form></details>;
}
