import { useState } from 'react';
import type { CameraCalibration, Obstacle } from '../../../contracts/index';
import { createFloorMapping, type Point2 } from './homography';

export function projectFootprint(calibration: CameraCalibration, points: Point2[], height: number) {
  if (points.length!==2 || !Number.isFinite(height) || height<=0 || height>5) throw new Error('Select two ground corners and a measured height between 0 and 5 m');
  const map=createFloorMapping(calibration.corners,calibration.width,calibration.depth);
  const [a,b]=points.map(p=>map.toWorld(p));
  if ([a,b].some(p=>Math.abs(p[0])>calibration.width/2 || Math.abs(p[1])>calibration.depth/2)) throw new Error('Ground footprint must be inside the calibrated stage');
  const sx=Math.abs(a[0]-b[0]),sy=Math.abs(a[1]-b[1]);
  if(sx<0.05||sy<0.05) throw new Error('Footprint must span at least 5 cm in both world axes');
  return { position: [(a[0]+b[0])/2,(a[1]+b[1])/2] as Point2, size:[sx,sy,height] as [number,number,number] };
}
export function ObstacleAnnotation({ video }: {video: HTMLVideoElement|null}) {
  const [frame,setFrame]=useState(''),[captured,setCaptured]=useState(''),[calibration,setCalibration]=useState<CameraCalibration|null>(null),[epoch,setEpoch]=useState(0),[episode,setEpisode]=useState('');
  const [points,setPoints]=useState<Point2[]>([]),[height,setHeight]=useState(0.8),[confirmed,setConfirmed]=useState(false),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const [obstacles,setObstacles]=useState<Obstacle[]>([]),[selected,setSelected]=useState('');
  const [observation,setObservation]=useState<{model:string;summary:string;proposals:{label:string;corners:Point2[];uncertainty:string}[];warnings:string[]}|null>(null);
  async function begin() {
    setBusy(true);
    try {
      if(!video?.videoWidth) throw new Error('Live video is required to capture a measured annotation frame');
      const [c,s,g]=await Promise.all([fetch('/api/camera/calibration'),fetch('/api/sim/state'),fetch('/api/sim/scene')]);
      if(!c.ok||!s.ok||!g.ok) throw new Error('Unlock operator access and connect simulation');
      const data=await c.json(),state=await s.json(),scene=await g.json();
      if(!data.calibration) throw new Error('Confirm floor calibration first');
      if(video.videoWidth!==data.calibration.frame_width||video.videoHeight!==data.calibration.frame_height) throw new Error('Camera frame dimensions changed. Recalibrate first.');
      const latest=await (await fetch('/api/sim/state')).json();
      if(latest.scene_epoch!==state.scene_epoch||latest.episode_id!==state.episode_id)throw new Error('Scene changed during capture. Capture again.');
      setCalibration(data.calibration);setEpoch(state.scene_epoch);setEpisode(state.episode_id);
      setObstacles(scene.obstacles);setSelected('');setHeight(.8);
      const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;canvas.getContext('2d')!.drawImage(video,0,0);
      setFrame(canvas.toDataURL('image/jpeg',.85));setCaptured(new Date().toISOString());setPoints([]);setConfirmed(false);setMessage('');setObservation(null);
    } catch(e) {setMessage(String(e));}finally{setBusy(false);}
  }
  let proposal: ReturnType<typeof projectFootprint>|undefined, problem='';
  if(calibration&&points.length===2) try {proposal=projectFootprint(calibration,points,height);} catch(e){problem=String(e);}
  async function apply() {
    if(!proposal||!calibration||!confirmed)return;
    setBusy(true);
    try {
      const response=await fetch('/api/world/obstacles',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scene_epoch:epoch,episode_id:episode,captured_at:calibration.captured_at,obstacle:{id:selected||`obstacle_${crypto.randomUUID().slice(0,8)}`,...proposal},confirmed:true})});
      if(!response.ok)throw new Error((await response.json()).error||'Obstacle rejected');
      setFrame('');setMessage('Measured obstacle applied. Previous scene results are stale.');
    }catch(e){setMessage(String(e));}finally{setBusy(false);}
  }
  async function remove() {
    if(!selected||!window.confirm(`Remove ${selected} from the current physics scene? Previous scene results will become stale.`))return;
    setBusy(true);
    try {
      const response=await fetch('/api/world/obstacles/remove',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:selected,scene_epoch:epoch,episode_id:episode,confirmed:true})});
      if(!response.ok)throw new Error((await response.json()).error||'Removal rejected');
      setFrame('');setMessage('Selected obstacle removed. Previous scene results are stale.');
    }catch(e){setMessage(String(e));}finally{setBusy(false);}
  }
  async function observe() {
    if(!frame||!calibration)return;
    setBusy(true);setMessage('Sending this selected still to OpenAI for an unverified proposal…');
    try {
      const response=await fetch('/api/observe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image:frame,captured_at:captured,calibration_at:calibration.captured_at,scene_epoch:epoch,episode_id:episode})});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||`Observation unavailable (${response.status})`);
      setObservation(data);setMessage('Observation received. Review proposed ground points; no scene geometry has changed.');
    }catch(e){setMessage(String(e));}finally{setBusy(false);}
  }
  return <section className="camera-obstacles"><fieldset disabled={busy} style={{border:0,padding:0,margin:0}}><button onClick={begin}>Mark obstacle</button><p role="status">{message}</p>{frame&&<><h3>Review measured obstacle</h3><label>Obstacle action <select value={selected} onChange={e=>{setSelected(e.target.value);setPoints([]);setConfirmed(false);setHeight(obstacles.find(o=>o.id===e.target.value)?.size[2]??.8);}}><option value="">Add new obstacle</option>{obstacles.map(o=><option key={o.id} value={o.id}>Move / replace {o.id}</option>)}</select></label>{selected&&<button onClick={remove}>Remove selected obstacle</button>}<p>Captured {captured}. Live video continues above. Click two opposite ground-contact footprint corners. The box is aligned to world X/Y; this does not infer height or rotated geometry.</p><div style={{position:'relative'}}><img src={frame} alt="Captured stage: select two opposite ground footprint corners" style={{width:'100%',height:'auto',display:'block',cursor:'crosshair'}} onClick={e=>{if(points.length===2)return;const r=e.currentTarget.getBoundingClientRect();setPoints([...points,[(e.clientX-r.left)/r.width,(e.clientY-r.top)/r.height]]);setConfirmed(false);}}/>{points.map(([x,y],i)=><span key={i} style={{position:'absolute',left:`${x*100}%`,top:`${y*100}%`,background:'#ffdb79',color:'#111',padding:4,pointerEvents:'none'}}>{i+1}</span>)}</div><div className="camera-observation"><p>Optional: sending this selected JPEG still to OpenAI uses your configured API account. Continuous video is not sent. Proposals can be wrong and never update geometry automatically.</p><button onClick={observe}>Ask Astra about this still</button>{observation&&<><p>{observation.model}: {observation.summary}</p>{observation.warnings?.map((warning,i)=><p key={i}>{warning}</p>)}{observation.proposals?.map((proposal,i)=><div key={i}><p>{proposal.label} — {proposal.uncertainty}</p><button onClick={()=>{setPoints(proposal.corners);setConfirmed(false);setMessage('Proposed corners selected. Check they are actual ground-contact points and confirm measured height.');}}>Review proposed corners {i+1}</button></div>)}</>}</div><label>Measured height (m) <input type="number" min="0.01" max="5" step="0.05" value={height} onChange={e=>{setHeight(Number(e.target.value));setConfirmed(false);}}/></label><p>0.8 m is only a starting assumption. Measure and confirm it.</p>{proposal&&<p>World center: {proposal.position.map(n=>n.toFixed(2)).join(', ')} m. Width × depth × height: {proposal.size.map(n=>n.toFixed(2)).join(' × ')} m.</p>}{problem&&<p role="alert">{problem}</p>}<label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> I confirm the ground footprint, measured height, fixed camera, and scene update.</label><div><button onClick={()=>{setPoints([]);setConfirmed(false);}}>Clear corners</button> <button onClick={begin}>Capture again</button> <button onClick={()=>setFrame('')}>Cancel annotation</button> <button disabled={!proposal||!confirmed||busy} onClick={apply}>Apply measured obstacle</button></div></>}</fieldset></section>;
}
