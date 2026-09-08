import {useEffect,useRef,useState} from 'react';
import {Archive,ChevronDown,Download,RefreshCw} from 'lucide-react';

export interface ArchivedExperiment {id:string;kind:string;created_at:string;sha256:string;[key:string]:unknown}
export function ExperimentArchive(){
  const [open,setOpen]=useState(false),[experiments,setExperiments]=useState<ArchivedExperiment[]>([]),[loaded,setLoaded]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState(''),[downloading,setDownloading]=useState<string|null>(null);
  const pending=useRef<AbortController|null>(null),downloadRequest=useRef<AbortController|null>(null),mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;pending.current?.abort();downloadRequest.current?.abort();};},[]);
  useEffect(()=>{if(open&&!loaded&&!loading)void refresh();},[open]);
  async function refresh(){
    pending.current?.abort();const controller=new AbortController();pending.current=controller;
    setLoading(true);setError('');
    const timer=setTimeout(()=>controller.abort(),30_000);
    try{
      const response=await fetch('/api/experiments',{credentials:'same-origin',signal:controller.signal});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||`Archive unavailable (${response.status})`);
      if(!Array.isArray(data.experiments)||data.experiments.some((item:unknown)=>!item||typeof item!=='object'||typeof (item as ArchivedExperiment).id!=='string'))throw new Error('Archive returned an invalid experiment list');
      if(mounted.current&&pending.current===controller){setExperiments(data.experiments);setLoaded(true);}
    }catch(reason){if(mounted.current&&pending.current===controller)setError(reason instanceof Error&&reason.name==='AbortError'?'Archive request timed out. Try refreshing.':String(reason));}
    finally{clearTimeout(timer);if(mounted.current&&pending.current===controller)setLoading(false);}
  }
  async function download(id:string,format:'json'|'mcap'){
    if(downloading)return;
    const controller=new AbortController();downloadRequest.current=controller;setDownloading(`${id}.${format}`);setError('');
    const timer=setTimeout(()=>controller.abort(),120_000);
    try{
      const response=await fetch(`/api/experiments/${encodeURIComponent(id)}.${format}`,{credentials:'same-origin',signal:controller.signal});
      if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error||`Download unavailable (${response.status})`);}
      const blob=await response.blob();if(!mounted.current)return;
      const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`${id.replace(/[^a-zA-Z0-9_-]/g,'_')}.${format}`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30_000);
    }catch(reason){if(mounted.current)setError(reason instanceof Error&&reason.name==='AbortError'?'Download timed out. Try again.':String(reason));}
    finally{clearTimeout(timer);if(mounted.current)setDownloading(null);}
  }
  return <section className="experiment-archive" style={{border:'1px solid var(--border, #293438)',borderRadius:10,marginTop:12,overflow:'hidden'}}>
    <button className="button" aria-expanded={open} aria-controls="experiment-archive-content" onClick={()=>setOpen(value=>!value)} style={{width:'100%',justifyContent:'space-between',border:0,borderRadius:0}}><span style={{display:'inline-flex',gap:8,alignItems:'center'}}><Archive size={14}/>Experiment archive{loaded&&<small>({experiments.length})</small>}</span><ChevronDown size={14} style={{transform:open?'rotate(180deg)':'none'}}/></button>
    {open&&<div id="experiment-archive-content" style={{padding:12}}><p style={{fontSize:12,margin:'0 0 12px',lineHeight:1.5}}>Saved evaluation trajectories and repair evidence. Camera video is not recorded in this archive.</p><button className="button compact" disabled={loading} onClick={()=>void refresh()}><RefreshCw size={12}/>{loading?'Loading…':'Refresh archive'}</button>
      {error&&<p role="alert" style={{fontSize:12,color:'#e7a19b',overflowWrap:'anywhere'}}>{error}</p>}
      {loading&&<p role="status" style={{fontSize:12}}>Loading saved experiments…</p>}
      {loaded&&!loading&&!error&&experiments.length===0&&<p style={{fontSize:12}}>No saved experiments yet. Completed evaluations and repair evidence will appear here when archived.</p>}
      {experiments.length>0&&<ul style={{listStyle:'none',padding:0,margin:'12px 0 0',maxHeight:360,overflowY:'auto'}}>{experiments.map(item=><li key={item.id} style={{borderTop:'1px solid var(--border, #293438)',padding:'10px 0'}}><details><summary style={{cursor:'pointer',fontSize:12,overflowWrap:'anywhere'}}><strong>{item.kind||'Experiment'}</strong> <span style={{opacity:.65}}>{item.created_at&&Number.isFinite(Date.parse(item.created_at))?new Date(item.created_at).toLocaleString():'Timestamp unavailable'}</span></summary><div style={{fontSize:11,lineHeight:1.6,marginTop:8,overflowWrap:'anywhere'}}><div>ID: <code>{item.id}</code></div><div>SHA-256: <code>{item.sha256||'Unavailable'}</code></div></div></details><div style={{display:'flex',gap:6,marginTop:8}}>{(['json','mcap'] as const).map(format=><button key={format} className="button compact" disabled={downloading!==null} onClick={()=>void download(item.id,format)} aria-label={`Download ${item.id} as ${format.toUpperCase()}`}><Download size={12}/>{downloading===`${item.id}.${format}`?'Downloading…':format.toUpperCase()}</button>)}</div></li>)}</ul>}
    </div>}
  </section>;
}
