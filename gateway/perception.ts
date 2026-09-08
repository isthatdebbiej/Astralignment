import type {Express} from 'express';
import {z} from 'zod';
import type {PerceptionFrame,PerceptionResult} from '../contracts/index';

export const perceptionFrameSchema=z.object({session_id:z.string().uuid(),frame_id:z.number().int().min(0).max(2**31-1),captured_at:z.number().finite().min(0).max(1e15),frame_width:z.number().int().min(64).max(1920),frame_height:z.number().int().min(64).max(1920),image:z.string().max(1_000_000).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/)}).strict();
const resultSchema=z.object({session_id:z.string().uuid(),frame_id:z.number().int().nonnegative(),captured_at:z.number().finite(),processed_at:z.number().finite(),frame_width:z.number().int(),frame_height:z.number().int(),status:z.enum(['searching','tracking','lost','error']),world_to_clip:z.array(z.number().finite()).length(16).nullable(),scale:z.enum(['estimated_metric','unavailable']),reason:z.string().max(2000),model:z.string().max(200),inference_ms:z.number().finite().nonnegative(),floor_inlier_ratio:z.number().finite().optional(),reprojection_error_px:z.number().finite().optional(),depth_preview:z.string().max(1_000_000).optional()});
export function validatePerceptionResult(value:unknown,frame:PerceptionFrame):PerceptionResult{
  const result=resultSchema.parse(value);
  if(result.session_id!==frame.session_id||result.frame_id!==frame.frame_id||result.captured_at!==frame.captured_at||result.frame_width!==frame.frame_width||result.frame_height!==frame.frame_height)throw new Error('Mismatched perception frame');
  if(result.status==='tracking'&&(!result.world_to_clip||result.scale!=='estimated_metric'))throw new Error('Tracking projection missing');
  if(result.status!=='tracking')result.world_to_clip=null;
  if(result.status==='error')result.reason='Perception could not process this frame. Restart spatial tracking.';
  return result;
}
export function registerPerception(app:Express,sceneProvider:()=>Promise<{width:number;depth:number}>){
  let inFlight=false;
  const config=()=>{const raw=process.env.PERCEPTION_URL,token=process.env.PERCEPTION_TOKEN;if(!raw||!token)throw new Error('Not configured');const url=new URL(raw);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw new Error('Invalid URL');return {base:url.toString().replace(/\/$/,''),token};};
  app.get('/api/perception/health',async(_req,res)=>{
    try{const {base,token}=config();const response=await fetch(`${base}/health`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(120_000),redirect:'error'});if(!response.ok)return res.status(503).json({ok:false,error:'Perception worker unavailable'});const data=await response.json() as Record<string,unknown>;return res.json({ok:data.ok===true,model:typeof data.model==='string'?data.model.slice(0,200):'unavailable',source_revision:typeof data.source_revision==='string'?data.source_revision.slice(0,100):undefined,automatic_floor:data.automatic_floor===true,metric_calibration:'estimated, not measured'});}catch{return res.status(503).json({ok:false,error:'Perception worker unavailable or not configured'});}
  });
  app.post('/api/perception/frame',async(req,res)=>{
    const parsed=perceptionFrameSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Invalid bounded JPEG camera frame'});
    const frame=parsed.data,bytes=Buffer.from(frame.image.slice(frame.image.indexOf(',')+1),'base64');
    if(bytes.length>1_000_000||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255)return res.status(400).json({error:'Camera frame must contain JPEG bytes'});
    if(inFlight)return res.status(429).json({error:'Perception busy. Submit only the latest frame after this request finishes.'});
    inFlight=true;
    try{
      const {base,token}=config(),scene=await sceneProvider();
      if(![scene.width,scene.depth].every(n=>Number.isFinite(n)&&n>=1&&n<=20))return res.status(400).json({error:'Current stage dimensions are outside perception support (1–20 m)'});
      const response=await fetch(`${base}/infer`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({...frame,stage_width:scene.width,stage_depth:scene.depth}),signal:AbortSignal.timeout(120_000),redirect:'error'});
      if(!response.ok)return res.status(response.status===429?429:503).json({error:response.status===429?'Perception worker busy. Retry with the latest frame.':'Perception worker unavailable. No projection was applied.'});
      const text=await response.text();if(text.length>2_000_000)throw new Error('Oversized result');
      const result=validatePerceptionResult(JSON.parse(text),frame);return res.json(result);
    }catch{return res.status(503).json({error:'Perception response unavailable or invalid. No projection was applied.'});}
    finally{inFlight=false;}
  });
}
