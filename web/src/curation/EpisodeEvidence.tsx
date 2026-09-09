import React,{useCallback,useEffect,useRef,useState} from 'react';
import type {Episode} from '../../../contracts/curation';
import {StateInspector,type SampleSelection} from './StateInspector';
export function EpisodeEvidence({episode}:{episode:Episode}){
 const [stream,setStream]=useState(()=>{const requested=new URLSearchParams(location.search).get('stream');return episode.streams.find(s=>s.id===requested)?.id??episode.streams[0]?.id??'';});
 const [frame,setFrame]=useState<number|null>(()=>{const raw=new URLSearchParams(location.search).get('frame');const value=Number(raw);return raw!==null&&Number.isInteger(value)&&value>=0&&value<episode.frames?value:null;}),[videoTime,setVideoTime]=useState<number|null>(null);
 const [mapping,setMapping]=useState('No source-backed video/state mapping selected.');
 const video=useRef<HTMLVideoElement>(null);
 const active=episode.streams.find(s=>s.id===stream);
 const artifact=episode.artifacts.find(a=>a.id===active?.artifact_id);
 useEffect(()=>{const url=new URL(location.href);if(frame!==null)url.searchParams.set('frame',String(frame));else url.searchParams.delete('frame');if(stream)url.searchParams.set('stream',stream);history.replaceState({},'',url);},[frame,stream]);
 useEffect(()=>{const pause=()=>{if(document.hidden)video.current?.pause();};document.addEventListener('visibilitychange',pause);return()=>document.removeEventListener('visibilitychange',pause);},[]);
 const select=useCallback((selection:SampleSelection)=>{
   const index=selection.row.frame_index;
   setFrame(typeof index==='number'&&Number.isInteger(index)&&!episode.findings.some(f=>f.includes('Frame index mapping differs'))?index:null);
   const reference=selection.references.find(r=>r.kind===active?.kind&&artifact?.path.replaceAll('\\','/').endsWith('/'+r.path.replaceAll('\\','/')));
   if(reference&&video.current){
     video.current.pause();video.current.currentTime=reference.timestamp;setVideoTime(reference.timestamp);
     setMapping('Linked by the source row’s explicit LeRobot video path/timestamp reference. This is not causal clock synchronization.');
   }else setMapping('State row selected. Video is unmapped and was not moved.');
 },[active?.kind,artifact?.path,episode.findings]);
 const annotations=frame===null?[]:episode.annotations.filter(a=>a.start_frame<=frame&&a.end_frame>frame);
 return <section aria-label="Recorded evidence">
 <label>Recorded camera<select value={stream} onChange={e=>{video.current?.pause();setStream(e.target.value);setVideoTime(null);setMapping('Camera changed. Mapping remains unknown until a matching source reference is selected.');}}>
 {episode.streams.map(s=><option key={s.id} value={s.id}>{s.kind}</option>)}</select></label>
 {active?<figure style={{margin:'16px 0'}}><video ref={video} key={active.artifact_id} controls preload="metadata" style={{width:'100%',maxHeight:480,background:'#111'}} src={'/api/v1/artifacts/'+active.artifact_id}
 onTimeUpdate={()=>setVideoTime(video.current?.currentTime??null)} onError={()=>setMapping('Recorded media could not be decoded by this browser. Inspect the integrity findings or original artifact.')}/>
 <figcaption>{active.timing}</figcaption></figure>:<p>No recorded video available.</p>}
 <details open><summary>Evidence timeline</summary><p className="cu-warning">{mapping}</p>
 <p>Native video position: {videoTime===null?'unknown':videoTime.toFixed(3)+' s'} · Native frame index: {frame??'unknown'}</p>
 <label>Inspect source annotation frame<input type="number" min={0} max={Math.max(0,episode.frames-1)} value={frame??''} placeholder="Native frame index"
 onChange={e=>{const value=Number(e.target.value);setFrame(e.target.value!==''&&Number.isInteger(value)&&value>=0&&value<episode.frames?value:null);setMapping('Source annotation frame selected; video and robot samples were not interpolated or moved.');}}/></label>
 {annotations.map((a,i)=><p key={i}>Source category {a.label} · [{a.start_frame}, {a.end_frame}) <a href={'/api/v1/artifacts/'+a.evidence}>Annotation evidence</a></p>)}
 {frame!==null&&!annotations.length&&<p>No source annotation covers this frame.</p>}
 <p>Gaps remain gaps. Unknown clock relationships are never replaced by a zero offset.</p>
 <StateInspector episode={episode} onSample={select} desiredFrame={frame}/>
 </details>
 </section>;
}
