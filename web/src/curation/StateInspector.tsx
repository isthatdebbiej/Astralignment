import React,{useEffect,useRef,useState} from 'react';
import type {Episode,Job} from '../../../contracts/curation';
import {curationApi} from './CollectionEditor';
type VideoReference={kind:string;path:string;timestamp:number};
export type SampleSelection={row:Record<string,unknown>;references:VideoReference[]};
type Samples={offset:number;columns:string[];rows:Record<string,unknown>[];timing:string;artifact_sha256:string;video_references?:VideoReference[][]};
export function StateInspector({episode,onSample,desiredFrame}:{episode:Episode;onSample?:(selection:SampleSelection)=>void;desiredFrame?:number|null}){
 const [job,setJob]=useState<Job|null>(null),[samples,setSamples]=useState<Samples|null>(null);
 const [error,setError]=useState(''),[cursor,setCursor]=useState(0),[requesting,setRequesting]=useState(false);
 const pending=job&&['queued','running'].includes(job.status);
 const activeJob=useRef<Job|null>(null);activeJob.current=job;
 useEffect(()=>()=>{const current=activeJob.current;if(current&&['queued','running'].includes(current.status))void curationApi('/jobs/'+current.id+'/cancel',{}).catch(()=>{});},[]);
 const missingFrame=desiredFrame!=null&&!!samples&&!samples.rows.some(row=>row.frame_index===desiredFrame);
 useEffect(()=>{if(samples?.rows[cursor]&&!missingFrame)onSample?.({row:samples.rows[cursor],references:samples.video_references?.[cursor]??[]});},[samples,cursor,onSample,missingFrame]);
 useEffect(()=>{if(desiredFrame==null||!samples)return;const found=samples.rows.findIndex(row=>row.frame_index===desiredFrame);if(found>=0)setCursor(found);},[desiredFrame,samples]);
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
 return <details onToggle={event=>{if(!event.currentTarget.open&&activeJob.current&&['queued','running'].includes(activeJob.current.status))void curationApi('/jobs/'+activeJob.current.id+'/cancel',{}).then(setJob).catch(e=>setError(e.message));}}><summary>Recorded state/action inspector</summary>
 <p>Reads up to 64 original rows per page. The cursor follows file order, not an inferred synchronized clock.</p>
 {!episode.artifacts.some(a=>a.kind==='state/action')?<p>No recorded state/action artifact.</p>:<>
 <button disabled={!!pending||requesting} onClick={()=>void load(0)}>Inspect recorded samples</button>
 {pending&&<p role="status">Preview {job.status}. Uses the shared CPU worker. <button onClick={()=>void curationApi('/jobs/'+job.id+'/cancel',{}).then(setJob).catch(e=>setError(e.message))}>Cancel preview</button></p>}
 {error&&<p role="alert">{error}</p>}
 {samples&&<><p>{samples.timing}</p><p className="cu-mono">Source checksum: {samples.artifact_sha256}</p>
 {missingFrame?<p className="cu-warning">Frame {desiredFrame} is not in the loaded page. <button disabled={!!pending||requesting} onClick={()=>void load(Math.floor(Number(desiredFrame)/64)*64)}>Load selected frame page</button></p>:samples.rows.length>0&&<><label>Recorded row cursor<input type="range" min={0} max={samples.rows.length-1} value={cursor} onChange={e=>setCursor(Number(e.target.value))}/></label>
 <p>File row {samples.offset+cursor} · native timestamp: {JSON.stringify(samples.rows[cursor]?.timestamp??'unavailable')}</p>
 {cursor>0&&typeof samples.rows[cursor]?.frame_index==='number'&&typeof samples.rows[cursor-1]?.frame_index==='number'&&Number(samples.rows[cursor].frame_index)!==Number(samples.rows[cursor-1].frame_index)+1&&<p className="cu-warning">Discontinuity in recorded frame indices. No samples have been inserted to fill it.</p>}
 <div className="cu-scroll"><table><thead><tr><th>Channel</th><th>Original value</th></tr></thead><tbody>{samples.columns.map(column=><tr key={column}><th>{column}</th><td><code>{JSON.stringify(samples.rows[cursor]?.[column])}</code></td></tr>)}</tbody></table></div></>}
 <footer><button disabled={!!pending||requesting||samples.offset===0} onClick={()=>void load(Math.max(0,samples.offset-64))}>Previous samples</button>
 <button disabled={!!pending||requesting||samples.rows.length<64||samples.offset+64>=episode.frames} onClick={()=>void load(samples.offset+64)}>Next samples</button></footer></>}
 </>}
 </details>;
}
