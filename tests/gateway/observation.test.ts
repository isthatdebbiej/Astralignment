import { test } from 'node:test';
import assert from 'node:assert/strict';
import { observationSchema, observationInput } from '../../gateway/observe';

test('Astra observations remain bounded, untrusted proposals',()=>{
  const value={summary:'One visible case on the floor',proposals:[{label:'case',corners:[[.2,.3],[.4,.5]],uncertainty:'Far contact edge is partially occluded'}],warnings:['Human must verify footprint and height']};
  assert.equal(observationSchema.parse(value).proposals.length,1);
  assert.throws(()=>observationSchema.parse({...value,proposals:[{...value.proposals[0],corners:[[2,.3],[.4,.5]]}]}));
  assert.throws(()=>observationSchema.parse({...value,proposals:[{...value.proposals[0],height:1}]}));
  assert.throws(()=>observationSchema.parse({...value,commands:['move_robot']}));
  assert.equal(observationSchema.parse({summary:'Ground is occluded',proposals:[],warnings:['No inferable footprint']}).proposals.length,0);
});
test('observation uploads require a bounded JPEG data URL and explicit scene/time identity',()=>{
  const input={image:'data:image/jpeg;base64,/9j/AAAA',captured_at:'2026-09-08T19:00:00.000Z',calibration_at:'measured-floor',scene_epoch:3,episode_id:'73da70a2-b450-4579-b41f-052a21d603f0'};
  assert.equal(observationInput.parse(input).scene_epoch,3);
  assert.throws(()=>observationInput.parse({...input,image:'https://example.com/private-camera'}));
  assert.throws(()=>observationInput.parse({...input,scene_epoch:-1}));
  assert.throws(()=>observationInput.parse({...input,image:'data:image/jpeg;base64,'+'A'.repeat(3_000_000)}));
});
