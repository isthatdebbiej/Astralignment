import React,{useState} from 'react';
import type {Episode} from '../../../contracts/curation';

export function IntervalFields({episode,prefix}:{episode:Episode;prefix:'selection'|'review'}){
 const [values,setValues]=useState(()=>{const url=new URL(location.href);return {scope:url.searchParams.get(prefix+'_scope')??'episode',stream:url.searchParams.get(prefix+'_stream')??episode.streams[0]?.id??'',start:url.searchParams.get(prefix+'_start')??'0',end:url.searchParams.get(prefix+'_end')??String(episode.frames)};});
 function change(key:keyof typeof values,value:string){const next={...values,[key]:value};setValues(next);const url=new URL(location.href);for(const [k,v] of Object.entries(next))url.searchParams.set(prefix+'_'+k,v);history.replaceState({},'',url);}
 const bound=episode.streams.find(s=>s.id===values.stream)?.bounds?.frames;
 return <div className="cu-grid">
 <label>{prefix==='selection'?'Selection scope':'Scope'}<select aria-label={prefix==='selection'?'Selection scope':'Scope'} name="scope" value={values.scope} onChange={e=>change('scope',e.target.value)}><option value="episode">Whole episode</option><option value="interval">Frame interval [start, end)</option></select></label>
 <label>{prefix==='selection'?'Selection stream':'Reference stream'}<select aria-label={prefix==='selection'?'Selection stream':'Reference stream'} name="stream" value={values.stream} onChange={e=>change('stream',e.target.value)}>{episode.streams.map(s=><option key={s.id} value={s.id}>{s.kind}</option>)}</select></label>
 <label>{prefix==='selection'?'First frame':'Start frame'}<input aria-label={prefix==='selection'?'First frame':'Start frame'} name="start" type="number" min={0} step={1} value={values.start} onChange={e=>change('start',e.target.value)} required={values.scope==='interval'}/></label>
 <label>{prefix==='selection'?'Last frame, exclusive':'End frame (exclusive)'}<input aria-label={prefix==='selection'?'Last frame, exclusive':'End frame (exclusive)'} name="end" type="number" min={1} max={bound??undefined} step={1} value={values.end} onChange={e=>change('end',e.target.value)} required={values.scope==='interval'}/></label>
 {values.scope==='interval'&&<p className="cu-warning">{bound==null?'This stream has no verified frame bounds. Reinspect the source before saving an interval.':`Verified source-frame bounds: [0, ${bound}).`}</p>}
 </div>;
}
