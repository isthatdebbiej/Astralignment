import test from 'node:test';
import assert from 'node:assert/strict';

test('confirmed measured 4x3 stage is accepted with safe goal clearance from proposed presenter strip', async()=>{
  const base=process.env.CALIBRATION_TEST_ORIGIN||'http://127.0.0.1:8787';
  const original=await (await fetch(`${base}/api/sim/scene`)).json();
  try {
    const response=await fetch(`${base}/api/camera/calibration`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmed:true,calibration:{width:4,depth:3,corners:[[.1,.9],[.9,.9],[.9,.1],[.1,.1]],captured_at:new Date().toISOString(),frame_width:320,frame_height:240}})});
    assert.equal(response.status,200,await response.text());
    const scene=await (await fetch(`${base}/api/sim/scene`)).json();
    assert.equal(scene.width,4);assert.equal(scene.depth,3);
    const goal=scene.robots.find((r:any)=>r.id==='g1_b').goal;
    const strip=scene.keepouts.find((k:any)=>k.id==='presenter');
    assert.ok(Math.min(...strip.polygon.map((p:number[])=>p[1]))-goal[1]>=.45);
  } finally {
    const response=await fetch(`${base}/api/sim/reset`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scene:original})});
    assert.equal(response.status,200,'Restore original scene');
  }
});
