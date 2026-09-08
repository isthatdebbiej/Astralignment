import {useCallback,useEffect,useRef,useState} from 'react';
import type {PerceptionFrame,PerceptionResult} from '../../../contracts/index';

export const PERCEPTION_CONSENT='Send selected camera frames to the perception worker on Modal';
export function perceptionFrameSize(width:number,height:number){
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw new Error('Camera frame dimensions unavailable');
  const factor=Math.min(1,640/width,480/height);
  return {width:Math.max(1,Math.round(width*factor)),height:Math.max(1,Math.round(height*factor))};
}
export function matchesPerceptionFrame(result:PerceptionResult,frame:PerceptionFrame){
  return result.session_id===frame.session_id&&result.frame_id===frame.frame_id&&result.captured_at===frame.captured_at&&result.frame_width===frame.frame_width&&result.frame_height===frame.frame_height;
}

/** start() must be called only from the explicit Modal frame-sharing consent action.
 * No automatic start, frame queue, calibration writes, or source-track ownership.
 */
export function usePerception(stream:MediaStream|null){
  const [enabled,setEnabled]=useState(false),[status,setStatus]=useState('Spatial tracking off'),[error,setError]=useState('');
  const [result,setResult]=useState<PerceptionResult|null>(null),[sessionId,setSessionId]=useState<string|null>(null),[framesSent,setFramesSent]=useState(0),[resultReceivedAt,setResultReceivedAt]=useState(0);
  const stopRef=useRef<()=>void>(()=>{}),frameCounter=useRef(0),consentedStream=useRef<MediaStream|null>(null);
  const stop=useCallback(()=>{stopRef.current();setEnabled(false);setResult(null);setError('');setStatus('Spatial tracking off');},[]);
  const start=useCallback(()=>{
    if(!stream?.getVideoTracks().some(track=>track.readyState==='live')){setError('Connect a live camera before starting spatial tracking');return;}
    stopRef.current();consentedStream.current=stream;frameCounter.current=0;setFramesSent(0);setResult(null);setError('');setResultReceivedAt(0);setSessionId(crypto.randomUUID());setStatus('Starting perception worker — first result can take up to two minutes');setEnabled(true);
  },[stream]);
  useEffect(()=>{
    if(!enabled||!stream||!sessionId||stream!==consentedStream.current){if(enabled&&(!stream||stream!==consentedStream.current))stop();return;}
    let active=true,warm=false,timer:ReturnType<typeof setTimeout>|undefined,request:AbortController|undefined,timeout:ReturnType<typeof setTimeout>|undefined,lastTime=-1,failures=0;
    const video=document.createElement('video');video.muted=true;video.autoplay=true;video.playsInline=true;video.srcObject=stream;
    const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
    const cleanup=()=>{active=false;clearTimeout(timer);clearTimeout(timeout);request?.abort();video.pause();video.srcObject=null;};
    stopRef.current=cleanup;
    const disconnected=()=>{cleanup();setEnabled(false);setResult(null);setStatus('Camera disconnected — spatial tracking stopped');};
    const tracks=stream.getVideoTracks();tracks.forEach(track=>track.addEventListener('ended',disconnected));
    const navigation=()=>{cleanup();setEnabled(false);setResult(null);setStatus('Spatial tracking stopped');};
    window.addEventListener('pagehide',navigation);
    const schedule=(delay:number)=>{if(active)timer=setTimeout(()=>void sendLatest(),delay);};
    async function sendLatest(){
      if(!active)return;
      if(!tracks.some(track=>track.readyState==='live')){disconnected();return;}
      if(!ctx||video.readyState<2||!video.videoWidth||video.currentTime===lastTime){schedule(250);return;}
      const began=Date.now();
      try{
        const size=perceptionFrameSize(video.videoWidth,video.videoHeight);canvas.width=size.width;canvas.height=size.height;ctx.drawImage(video,0,0,size.width,size.height);lastTime=video.currentTime;
        const image=canvas.toDataURL('image/jpeg',.72);if(image.length>1_000_000)throw new Error('Selected frame exceeds the upload size limit');
        const frame:PerceptionFrame={session_id:sessionId!,frame_id:frameCounter.current++,captured_at:Date.now(),frame_width:size.width,frame_height:size.height,image};
        request=new AbortController();timeout=setTimeout(()=>request?.abort(),warm?30_000:120_000);
        setStatus(warm?'Processing latest camera frame':'Starting perception worker — first result can take up to two minutes');setFramesSent(count=>count+1);
        const response=await fetch('/api/perception/frame',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(frame),signal:request.signal});
        if(!active)return;
        const data=await response.json();
        if(!active)return;
        if(!response.ok){if(response.status===401||response.status===403){setError(data.error||'Operator access required');setStatus('Perception access denied');setResult(null);cleanup();setEnabled(false);return;}throw new Error(data.error||`Perception unavailable (${response.status})`);}
        const next=data as PerceptionResult;if(!matchesPerceptionFrame(next,frame))throw new Error('Perception returned a stale or mismatched frame');
        if(/unknown session|session.*(?:expired|missing|not found)|(?:start|begin) a new session/i.test(next.reason)){cleanup();setEnabled(false);setResult(null);setError('Tracking session was lost. Press Start spatial tracking to restart.');setStatus('Restart spatial tracking');return;}
        warm=true;failures=0;setResult(next);setResultReceivedAt(Date.now());setError('');setStatus(next.status==='tracking'?'Spatial tracking':next.reason||next.status);
      }catch(reason){if(active){setResult(null);setError(reason instanceof Error&&reason.name==='AbortError'?'Perception timed out. Retrying with the newest frame.':String(reason));setStatus('Perception unavailable');failures++;}}
      finally{clearTimeout(timeout);request=undefined;if(active)schedule(failures?Math.min(10_000,1000*failures):Math.max(0,500-(Date.now()-began)));}
    }
    void video.play().then(()=>schedule(0)).catch(()=>{if(active){setError('Camera playback could not start for spatial tracking');disconnected();}});
    return()=>{cleanup();tracks.forEach(track=>track.removeEventListener('ended',disconnected));window.removeEventListener('pagehide',navigation);};
  },[enabled,stream,sessionId,stop]);
  const currentResult=enabled&&stream===consentedStream.current&&result?.session_id===sessionId?result:null;
  return {start,stop,enabled,status,error,result:currentResult,sessionId,framesSent,resultReceivedAt};
}
