import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateCameraProjection,containVideoRect,fitCameraProjection } from '../../web/src/camera/projection';
import type { CameraCalibration } from '../../contracts/index';

test('known oblique pinhole camera reconstructs floor and elevated point projection',()=>{
  const fov=60,fy=.5/Math.tan(Math.PI/6),fx=fy*720/1280,c=Math.cos(.35),s=Math.sin(.35);
  const project=([x,y,z]:number[])=>[.5+fx*x/(s*y-c*z+6),.5+fy*(-c*y-s*z)/(s*y-c*z+6)] as [number,number];
  const calibration:CameraCalibration={width:4,depth:3,frame_width:1280,frame_height:720,captured_at:new Date().toISOString(),corners:[[-2,-1.5,0],[2,-1.5,0],[2,1.5,0],[-2,1.5,0]].map(project)};
  const result=estimateCameraProjection(calibration,fov);
  assert.ok(result.reprojectionRmsPixels<1e-8);
  assert.ok(Math.abs(result.cameraPosition[2]-6*c)<1e-8);
  const p:[number,number,number]=[.4,.3,1.2],expected=project(p),actual=result.project(p);
  expected.forEach((n,i)=>assert.ok(Math.abs(n-actual[i])<1e-8));
  const m=result.worldToClip,v=[...p,1],clip=[0,1,2,3].map(row=>v.reduce((sum,n,col)=>sum+n*m[col*4+row],0));
  assert.ok(Math.abs((clip[0]/clip[3]+1)/2-expected[0])<1e-8);
  assert.ok(Math.abs((1-clip[1]/clip[3])/2-expected[1])<1e-8);
  assert.ok(estimateCameraProjection(calibration,90).reprojectionRmsPixels>1);
  assert.throws(()=>estimateCameraProjection(calibration,NaN));
  const fit=fitCameraProjection(calibration);assert.ok(Math.abs(fit.estimatedFovDegrees-60)<.1);assert.equal(fit.fitWeak,false);
});
test('video contain preserves pixels without crop and reports letterboxing',()=>{
  const actual=containVideoRect(1000,1000,1920,1080),expected={x:0,y:218.75,width:1000,height:562.5};
  for(const key of ['x','y','width','height'] as const)assert.ok(Math.abs(actual[key]-expected[key])<1e-9);
  assert.throws(()=>containVideoRect(0,100,100,100));
});
