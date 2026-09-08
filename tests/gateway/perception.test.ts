import test from 'node:test';
import assert from 'node:assert/strict';
import {perceptionFrameSchema,validatePerceptionResult} from '../../gateway/perception';
const frame={session_id:'73da70a2-b450-4579-b41f-052a21d603f0',frame_id:0,captured_at:1000,frame_width:640,frame_height:480,image:'data:image/jpeg;base64,/9j/'};
test('perception request is bounded and begins at frame zero',()=>{
  assert.equal(perceptionFrameSchema.parse(frame).frame_id,0);
  for(const change of [{frame_id:-1},{session_id:'bad'},{frame_width:63},{image:'data:image/png;base64,AAAA'},{image:'data:image/jpeg;base64,'+'A'.repeat(1_000_000)},{stage_width:8}])assert.equal(perceptionFrameSchema.safeParse({...frame,...change}).success,false);
});
test('perception result must match frame identity and finite projection',()=>{
  const result={...frame,processed_at:2000,status:'tracking',world_to_clip:Array(16).fill(0),scale:'estimated_metric',reason:'fixture',model:'fixture',inference_ms:1};
  assert.equal(validatePerceptionResult(result,frame).frame_id,0);
  for(const change of [{frame_id:1},{session_id:'34d37bea-73fd-4398-af2a-8fa72b770719'},{frame_width:320},{world_to_clip:Array(16).fill(NaN)},{world_to_clip:null},{status:'invented'}])assert.throws(()=>validatePerceptionResult({...result,...change},frame));
  assert.equal(validatePerceptionResult({...result,status:'lost'},frame).world_to_clip,null);
});
