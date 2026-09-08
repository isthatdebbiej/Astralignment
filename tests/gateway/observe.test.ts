import test from 'node:test';
import assert from 'node:assert/strict';
import { observationInput } from '../../gateway/observe';
test('observation origin requires episode UUID in addition to epoch',()=>{
  const input={image:'data:image/jpeg;base64,/9j/',captured_at:new Date().toISOString(),calibration_at:'fixture',scene_epoch:1,episode_id:'73da70a2-b450-4579-b41f-052a21d603f0'};
  assert.equal(observationInput.safeParse(input).success,true);
  assert.equal(observationInput.safeParse({...input,episode_id:undefined}).success,false);
  assert.equal(observationInput.safeParse({...input,episode_id:'1'}).success,false);
  assert.equal(observationInput.safeParse({...input,scene_epoch:0}).success,false);
});
