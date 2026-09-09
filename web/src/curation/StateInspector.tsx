import React,{useEffect,useState} from 'react';
import type {Episode,Job} from '../../../contracts/curation';
import {curationApi} from './CollectionEditor';
type Samples={offset:number;columns:string[];rows:Record<string,unknown>[];timing:string;artifact_sha256:string};
export function StateInspector({episode}:{episode:Episode}){
 const [job,setJob]=useState<Job|null>(null),[samples,setSamples]=useState<Samples|null>(null);
 const [error,setError]=useState(''),[cursor,setCursor]=useState(0),[requesting,setRequesting]=useState(false);
 const pending=job&&['queued','running'].includes(job.status);
 useEffect(()=>{
 if(!job||!['queued','running'].includes(job.status))return;
 let active=true;
 const timer=setInterval(()=>{void curationApi('/jobs/'+job.id).then((next:Job)=>{
 if(!active)return;setJob(next);
 if(next.status==='completed'){setSamples(next.result as unknown as Samples);setCursor(0);}
 if(next.status==='failed')setError(next.error??'Preview failed');
 }).catch(e=>{if(active)setError(e.message);});},1000);
 return()=>{active=false;clearInterval(timer);};
 },[job?.id,job?.status]);
 async function load(offset:number){setError('');setRequesting(true);try{setJob(await curationApi('/episodes/'+episode.id+'/samples',{offset,limit:64}));}catch(e){setError((e as Error).message);}finally{setRequesting(false);}}
 return <details><summary>Recorded state/action inspector</summary>
 <p>Reads up to 64 original rows per page. The cursor follows file order, not an inferred synchronized clock.</p>
 {!episode.artifacts.some(a=>a.kind==='state/action')?<p>No recorded state/action artifact.</p>:<>
 <button disabled={!!pending||requesting} onClick={()=>void load(0)}>Inspect recorded samples</button>
 {pending&&<p role="status">Preview {job.status}. Uses the shared CPU worker. <button onClick={()=>void curationApi('/jobs/'+job.id+'/cancel',{}).then(setJob).catch(e=>setError(e.message))}>Cancel preview</button></p>}
 {error&&<p role="alert">{error}</p>}
 {samples&&<><p>{samples.timing}</p><p className="cu-mono">Source checksum: {samples.artifact_sha256}</p>
 {samples.rows.length>0&&<><label>Recorded row cursor<input type="range" min={0} max={samples.rows.length-1} value={cursor} onChange={e=>setCursor(Number(e.target.value))}/></label>
 <p>File row {samples.offset+cursor} · native timestamp: {JSON.stringify(samples.rows[cursor]?.timestamp??'unavailable')}</p>
 <div className="cu-scroll"><table><thead><tr><th>Channel</th><th>Original value</th></tr></thead><tbody>{samples.columns.map(column=><tr key={column}><th>{column}</th><td><code>{JSON.stringify(samples.rows[cursor]?.[column])}</code></td></tr>)}</tbody></table></div></>}
 <footer><button disabled={!!pending||requesting||samples.offset===0} onClick={()=>void load(Math.max(0,samples.offset-64))}>Previous samples</button>
 <button disabled={!!pending||requesting||samples.rows.length<64||samples.offset+64>=episode.frames} onClick={()=>void load(samples.offset+64)}>Next samples</button></footer></>}
 </>}
 </details>;
}
