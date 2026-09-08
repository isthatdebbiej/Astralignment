import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {isLoopbackTestOrigin,requireOverlayMutationOptIn} from './test-origin-safety';
test.use({channel:'chrome',headless:true,trace:'off',screenshot:'off',video:'off',viewport:{width:1512,height:982}});
test('live synthetic video preserves pixels beneath authoritative elevated G1 overlay',async({browser})=>{
  test.setTimeout(180_000);
  // This gate runs before creating a context, authenticating, or making any request.
  const base=requireOverlayMutationOptIn(process.env.OVERLAY_TEST_ORIGIN||'http://127.0.0.1:5173',process.env.OVERLAY_TEST_ALLOW_REMOTE_MUTATION),context=await browser.newContext({viewport:{width:1512,height:982}});
  if(base.startsWith('https:')){const token=readFileSync('D:/Projects/astra-operator-token.txt','utf8').trim();expect((await context.request.post(`${base}/api/auth`,{headers:{Origin:base},data:{token}})).status()).toBe(200);}
  const api=async(path:string,body?:unknown)=>{const response=body===undefined?await context.request.get(base+path):await context.request.post(base+path,{data:body});expect(response.ok(),`${path} status`).toBe(true);return response.json();};
  const original=await api('/api/sim/scene'),previousCalibration=(await api('/api/camera/calibration')).calibration;
  if(!isLoopbackTestOrigin(base)&&!previousCalibration){await context.close();throw new Error('Refusing remote fixture: an absent calibration cannot be restored through the current API. Use a disposable local test environment.');}
  const fy=.5/Math.tan(Math.PI/6),fx=fy*720/1280,c=Math.cos(.55),s=Math.sin(.55);
  const project=([x,y,z]:number[])=>[.5+fx*x/(s*y-c*z+5),.5+fy*(-c*y-s*z)/(s*y-c*z+5)];
  const corners=[[-2,-1.5,0],[2,-1.5,0],[2,1.5,0],[-2,1.5,0]].map(project);
  const errors:string[]=[];
  try{
    await api('/api/camera/calibration',{confirmed:true,calibration:{width:4,depth:3,corners,captured_at:new Date().toISOString(),frame_width:1280,frame_height:720}});
    await context.addInitScript(({corners})=>{
      const state=window as any;state.__overlayTest={green:false};
      // Retain the actual rendered alpha buffer for this test's pixel assertions only.
      const get=HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext=function(kind:any,options:any){return (get as any).call(this,kind,/webgl/.test(kind)?{...options,preserveDrawingBuffer:true}:options);} as any;
      Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{
        const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;const ctx=canvas.getContext('2d')!;
        const paint=()=>{ctx.fillStyle='#171f24';ctx.fillRect(0,0,1280,720);ctx.fillStyle='#52605f';ctx.beginPath();corners.forEach(([x,y],i)=>i?ctx.lineTo(x*1280,y*720):ctx.moveTo(x*1280,y*720));ctx.closePath();ctx.fill();ctx.strokeStyle='#9db3ad';ctx.lineWidth=3;ctx.stroke();ctx.fillStyle=state.__overlayTest.green?'#00ff00':'#ff0000';ctx.fillRect(0,0,48,48);ctx.fillStyle='#d9e4df';ctx.font='20px sans-serif';ctx.fillText('SYNTHETIC CAMERA · TEST FIXTURE',36,672);};
        paint();const timer=setInterval(paint,40),stream=canvas.captureStream(25);for(const track of stream.getTracks()){const stop=track.stop.bind(track);track.stop=()=>{clearInterval(timer);stop();};}return stream;
      }});
    },{corners});
    const viewer=await context.newPage(),sender=await context.newPage();viewer.on('pageerror',error=>errors.push(error.message.replace(/([?&](?:token|session)=)[^\s&]+/g,'$1[redacted]')));
    await viewer.goto(base);await viewer.getByRole('button',{name:'Connect a phone camera',exact:true}).click();await viewer.getByRole('button',{name:'Pair iPhone',exact:true}).click();
    const link=viewer.getByRole('textbox',{name:'Pairing link'});await expect(link).toBeVisible();await sender.goto(await link.inputValue());await sender.getByRole('button',{name:'Start camera',exact:true}).click();
    await viewer.getByRole('button',{name:'View camera overlay',exact:true}).click();
    const overlay=viewer.locator('.camera-overlay-stage');await expect(overlay).toHaveAttribute('data-overlay-ready','true',{timeout:60_000});await expect(overlay).toHaveAttribute('data-overlay-meshes','54/54',{timeout:60_000});
    const videoPixel=()=>viewer.locator('.camera-original-video').evaluate((v:HTMLVideoElement)=>{const c=document.createElement('canvas');c.width=1;c.height=1;const ctx=c.getContext('2d')!;ctx.drawImage(v,10,10,1,1,0,0,1,1);return Array.from(ctx.getImageData(0,0,1,1).data);});
    await expect.poll(async()=>{const p=await videoPixel();return p[0]>150&&p[1]<100;}).toBe(true);await sender.evaluate(()=>{(window as any).__overlayTest.green=true;});await expect.poll(async()=>{const p=await videoPixel();return p[1]>150&&p[0]<100;}).toBe(true);
    const alpha=()=>viewer.locator('.camera-overlay-canvas canvas').evaluate((canvas:HTMLCanvasElement)=>{const c=document.createElement('canvas');c.width=canvas.width;c.height=canvas.height;const ctx=c.getContext('2d')!;ctx.drawImage(canvas,0,0);const pixels=ctx.getImageData(0,0,c.width,c.height).data;let opaque=0,transparent=0;for(let i=3;i<pixels.length;i+=4){if(pixels[i]>0)opaque++;else transparent++;}return {opaque,transparent};});
    await expect.poll(async()=>(await alpha()).opaque).toBeGreaterThan(300);expect((await alpha()).transparent).toBeGreaterThan(10000);
    // Preserve the actual receiver track objects, not merely another live stream.
    await viewer.locator('.camera-original-video').evaluate((video:HTMLVideoElement)=>{(window as any).__overlayTest.receiverTracks=(video.srcObject as MediaStream).getTracks();});
    const tracksLive=()=>viewer.evaluate(()=>(window as any).__overlayTest.receiverTracks.every((track:MediaStreamTrack)=>track.readyState==='live'));
    await viewer.getByRole('button',{name:'World',exact:true}).click();expect(await tracksLive()).toBe(true);
    await viewer.getByRole('button',{name:'Camera overlay',exact:true}).click();
    await expect(overlay).toHaveAttribute('data-overlay-ready','true',{timeout:60_000});
    for(const [open,close] of [['Setup','Close setup'],['Code','Close inspector'],['Evidence','Close inspector'],['Trace','Close inspector']]){
      await viewer.getByRole('button',{name:open,exact:true}).click();expect(await tracksLive()).toBe(true);
      await viewer.getByRole('button',{name:close,exact:true}).click();expect(await tracksLive()).toBe(true);
    }
    const timeline=viewer.getByRole('button',{name:'Timeline',exact:true});
    const expanded=await timeline.getAttribute('aria-expanded');await timeline.click();expect(await tracksLive()).toBe(true);await timeline.click();await expect(timeline).toHaveAttribute('aria-expanded',expanded!);
    await expect(overlay).toHaveAttribute('data-overlay-ready','true');await expect(overlay).toHaveAttribute('data-overlay-meshes','54/54');
    expect(await viewer.locator('.camera-original-video').evaluate((video:HTMLVideoElement)=>{const original=(window as any).__overlayTest.receiverTracks;return (video.srcObject as MediaStream).getTracks().every(track=>original.includes(track)&&track.readyState==='live');})).toBe(true);
    await expect.poll(async()=>(await alpha()).opaque).toBeGreaterThan(300);
    const before=await api('/api/sim/state');await api('/api/sim/run',{mode:'independent'});await expect.poll(async()=>(await api('/api/sim/state')).tick,{timeout:15_000}).toBeGreaterThan(before.tick+30);await api('/api/sim/pause',{});const after=await api('/api/sim/state');expect(JSON.stringify(after.bodies)).not.toBe(JSON.stringify(before.bodies));
    await expect(overlay).toHaveAttribute('data-overlay-ready','true');
    await expect.poll(async()=>(await alpha()).opaque).toBeGreaterThan(300);
    // Allow the authoritative paused snapshot to commit through the renderer before capture.
    await viewer.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
    expect((await alpha()).opaque).toBeGreaterThan(300);
    await viewer.screenshot({path:base.startsWith('https:')?'artifacts/qa/remote-live-overlay.png':'artifacts/qa/desktop-live-overlay.png'});
    await sender.getByRole('button',{name:'Stop camera',exact:true}).click();await expect(overlay).toHaveAttribute('data-overlay-ready','false',{timeout:10_000});await expect.poll(async()=>(await alpha()).opaque).toBe(0);
    expect(errors).toEqual([]);
  }finally{if(previousCalibration)await api('/api/camera/calibration',{confirmed:true,calibration:previousCalibration});await api('/api/sim/reset',{scene:original});await context.close();}
});
