import { test, expect } from '@playwright/test';
import { isLoopbackTestOrigin, requireOverlayMutationOptIn } from './test-origin-safety';

// Synthetic desktop transport test only. Does not access a physical camera or prove iPhone compatibility.
test.use({ channel: 'chrome', headless: true, trace: 'off', screenshot: 'off', video: 'off' });
test('synthetic camera transport and confirmed obstacle add move remove reach physics', async ({ browser }) => {
  test.setTimeout(180_000);
  // Use the same explicit remote mutation acknowledgment as the overlay fixture.
  const base = requireOverlayMutationOptIn(process.env.CAMERA_TEST_ORIGIN || 'http://127.0.0.1:5173', process.env.OVERLAY_TEST_ALLOW_REMOTE_MUTATION);
  const context = await browser.newContext();
  const originalScene = await (await context.request.get(`${base}/api/sim/scene`)).json();
  const previousCalibration = (await (await context.request.get(`${base}/api/camera/calibration`)).json()).calibration;
  if (!isLoopbackTestOrigin(base) && !previousCalibration) { await context.close(); throw new Error('Refusing remote camera fixture: an absent calibration cannot be restored through the current API.'); }
  const errors: string[] = [];
  const sanitize = (text: string) => text.replace(/([?&](?:session|token)=)[^&\s"']+/g, '$1[redacted]');
  await context.addInitScript(() => {
    const state = window as any;
    state.__cameraTest = { peers: [], streams: [], color: '#ff0000' };
    const Original = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends Original {
      constructor(config?: RTCConfiguration) { super(config); state.__cameraTest.peers.push(this); }
    };
    // Explicit test-only replacement; never calls native getUserMedia.
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
      const ctx = canvas.getContext('2d')!;
      const paint = () => { ctx.fillStyle = state.__cameraTest.color; ctx.fillRect(0,0,320,240); ctx.fillStyle = 'white'; ctx.font = '18px sans-serif'; ctx.fillText('SYNTHETIC TRANSPORT TEST', 12, 210); };
      paint(); const timer = setInterval(paint, 40);
      const stream = canvas.captureStream(25); state.__cameraTest.streams.push(stream);
      stream.getTracks().forEach(track => { const stop = track.stop.bind(track); track.stop = () => { clearInterval(timer); stop(); }; });
      return stream;
    } });
  });
  const viewer = await context.newPage();
  const sender = await context.newPage();
  for (const page of [viewer,sender]) {
    page.on('pageerror', e => errors.push(sanitize(e.message)));
    page.on('console', m => { if (m.type() === 'error' && /camera|webrtc|rtcpeer/i.test(m.text())) errors.push(sanitize(m.text())); });
  }
  try {
    await viewer.goto(base);
    await viewer.getByRole('button', { name: 'Connect phone', exact: true }).click();
    await viewer.getByRole('button', { name: 'Pair iPhone', exact: true }).click();
    const link = viewer.getByRole('textbox', { name: 'Pairing link' });
    await expect(link).toBeVisible();
    const cameraSenderPage = await link.inputValue();
    // Never log pairing URL or preserve traces/screenshots containing bearer credentials.
    await sender.goto(cameraSenderPage);
    await sender.getByRole('button', { name: 'Start camera', exact: true }).click();
    for (const page of [viewer,sender]) await expect.poll(() => page.evaluate(() => (window as any).__cameraTest.peers.some((p: RTCPeerConnection) => p.connectionState === 'connected')), { timeout: 20_000 }).toBe(true);
    const pixel = () => viewer.locator('.camera-panel video').evaluate((node: HTMLVideoElement) => {
      if (!node.videoWidth || !node.videoHeight) return [0,0,0];
      const c = document.createElement('canvas'); c.width=1; c.height=1;
      const ctx=c.getContext('2d')!; ctx.drawImage(node,0,0,1,1); return Array.from(ctx.getImageData(0,0,1,1).data).slice(0,3);
    });
    await expect.poll(async () => { const [r,g] = await pixel(); return r>150 && g<100; }).toBe(true);
    await sender.evaluate(() => { (window as any).__cameraTest.color='#00ff00'; });
    await expect.poll(async () => { const [r,g] = await pixel(); return g>150 && r<100; }).toBe(true);
    viewer.on('dialog',dialog=>dialog.accept());
    const api = async (path:string, body?:unknown) => {
      const response=body===undefined?await context.request.get(base+path):await context.request.post(base+path,{data:body});
      expect(response.ok(),`Fixture API ${path} status`).toBe(true);return response.json();
    };
    const clickNormalized = async (alt:string,points:number[][]) => {
      const img=viewer.getByRole('img',{name:alt,exact:true});await img.scrollIntoViewIfNeeded();
      const rect=await img.boundingBox();expect(rect).toBeTruthy();
      for(const [x,y] of points)await img.click({position:{x:x*rect!.width,y:y*rect!.height}});
    };
    await viewer.getByRole('button',{name:'Capture calibration still',exact:true}).click();
    await clickNormalized('Stage calibration still; select four measured floor corners',[[.1,.9],[.9,.9],[.9,.1],[.1,.1]]);
    await viewer.getByLabel('Width (m)',{exact:true}).fill('8');await viewer.getByLabel('Depth (m)',{exact:true}).fill('6');
    await viewer.getByRole('button',{name:'Confirm and apply calibration',exact:true}).click();
    await expect(viewer.getByText('Confirmed measured floor calibration saved',{exact:true})).toBeVisible();
    const before=await api('/api/sim/state'),checkpoint=await api('/api/sim/checkpoint',{});
    const mark=async(points:number[][],id?:string)=>{
      await viewer.getByRole('button',{name:'Mark obstacle',exact:true}).click();
      await expect(viewer.getByRole('heading',{name:'Review measured obstacle'})).toBeVisible();
      if(id)await viewer.getByLabel('Obstacle action').selectOption(id);
      await clickNormalized('Captured stage: select two opposite ground footprint corners',points);
      await viewer.getByLabel('Measured height (m)',{exact:true}).fill('0.8');
      await viewer.getByLabel('I confirm the ground footprint, measured height, fixed camera, and scene update.').check();
      await viewer.getByRole('button',{name:'Apply measured obstacle',exact:true}).click();
      await expect(viewer.getByRole('heading',{name:'Review measured obstacle'})).not.toBeVisible();
    };
    await mark([[.56,.5266666667],[.6,.4733333333]]);
    const added=await api('/api/sim/scene'),afterAdd=await api('/api/sim/state');
    expect(added.obstacles).toHaveLength(1);expect(afterAdd.scene_epoch).toBeGreaterThan(before.scene_epoch);
    const id=added.obstacles[0].id;
    const model=await api('/api/sim/model');
    const geom=model.geoms.find((g:any)=>g.kind==='box'&&g.name.includes(id));expect(geom).toBeTruthy();
    const body=afterAdd.bodies.find((b:any)=>b.name===geom.body);expect(body).toBeTruthy();expect(body.position[2]).toBeCloseTo(.4,4);
    expect((await context.request.post(`${base}/api/sim/fork`,{data:{checkpoint_id:checkpoint.checkpoint_id}})).status()).toBe(409);
    await mark([[.6,.42],[.64,.3666666667]],id);
    const moved=await api('/api/sim/scene'),afterMove=await api('/api/sim/state');
    // Native pointer coordinates quantize to CSS pixels: allow 2 cm on this 8 m stage.
    expect(moved.obstacles).toHaveLength(1);expect(moved.obstacles[0].id).toBe(id);expect(Math.abs(moved.obstacles[0].position[0]-1.2)).toBeLessThan(.02);expect(Math.abs(moved.obstacles[0].position[1]-.8)).toBeLessThan(.02);expect(afterMove.scene_epoch).toBeGreaterThan(afterAdd.scene_epoch);
    await viewer.getByRole('button',{name:'Mark obstacle',exact:true}).click();await viewer.getByLabel('Obstacle action').selectOption(id);
    await viewer.getByRole('button',{name:'Remove selected obstacle',exact:true}).click();
    await expect(viewer.getByRole('heading',{name:'Review measured obstacle'})).not.toBeVisible();
    expect((await api('/api/sim/scene')).obstacles).toHaveLength(0);expect((await api('/api/sim/state')).scene_epoch).toBeGreaterThan(afterMove.scene_epoch);
    await sender.getByRole('button', { name: 'Stop camera', exact: true }).click();
    await expect.poll(() => sender.evaluate(() => (window as any).__cameraTest.streams.every((s: MediaStream) => s.getTracks().every(t=>t.readyState==='ended')))).toBe(true);
    await expect.poll(() => sender.evaluate(() => (window as any).__cameraTest.peers.every((p: RTCPeerConnection) => p.connectionState==='closed'))).toBe(true);
    expect(errors).toEqual([]);
  } finally { if(previousCalibration){const restoredCalibration=await context.request.post(`${base}/api/camera/calibration`,{data:{confirmed:true,calibration:previousCalibration}});expect(restoredCalibration.ok(),'Restore original calibration').toBe(true);}const restored=await context.request.post(`${base}/api/sim/reset`,{data:{scene:originalScene}});expect(restored.ok(),'Restore original scene').toBe(true);await context.close(); }
});
