import test from 'node:test';
import assert from 'node:assert/strict';
import {perceptionFrameSize,matchesPerceptionFrame} from '../../web/src/camera/usePerception';
import type {PerceptionFrame,PerceptionResult} from '../../contracts/index';
test('perception downscales without cropping or upscaling',()=>{
  assert.deepEqual(perceptionFrameSize(1920,1080),{width:640,height:360});
  assert.deepEqual(perceptionFrameSize(1080,1920),{width:270,height:480});
  assert.deepEqual(perceptionFrameSize(320,240),{width:320,height:240});
  assert.throws(()=>perceptionFrameSize(0,1080));
});
test('perception rejects mismatched session, frame identity and image dimensions',()=>{
  const frame:PerceptionFrame={session_id:'fixture',frame_id:2,captured_at:1000,frame_width:640,frame_height:360,image:'fixture'};
  const result:PerceptionResult={...frame,processed_at:2000,status:'searching',world_to_clip:null,scale:'unavailable',reason:'fixture',model:'fixture',inference_ms:100};
  assert.equal(matchesPerceptionFrame(result,frame),true);
  for(const change of [{frame_id:1},{session_id:'different'},{captured_at:999},{frame_width:320}])assert.equal(matchesPerceptionFrame({...result,...change},frame),false);
});
