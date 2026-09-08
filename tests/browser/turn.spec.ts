import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Real remote relay infrastructure check with synthetic media only. Never prints credentials/SDP.
test.use({channel:'chrome',headless:true,trace:'off',screenshot:'off',video:'off'});
test('deployed ephemeral TURN relays synthetic moving video and data',async({browser})=>{
  test.setTimeout(120_000);
  const base='https://astralignment.64.177.14.149.sslip.io';
  const context=await browser.newContext();
  try {
    const secret=readFileSync('D:/Projects/astra-operator-token.txt','utf8').trim();
    const auth=await context.request.post(`${base}/api/auth`,{headers:{Origin:base},data:{token:secret}});
    expect(auth.status(),'Remote operator authentication status').toBe(200);
    const sessionResponse=await context.request.post(`${base}/api/camera/session`,{headers:{Origin:base}});
    expect(sessionResponse.status(),'Remote pairing creation status').toBe(200);
    const session=await sessionResponse.json();
    const page=await context.newPage();
    await page.goto(`${base}/phone`,{waitUntil:'domcontentloaded'});
    const result=await page.evaluate(async({token})=>{
      const response=await fetch('/api/camera/config',{headers:{Authorization:`Bearer ${token}`},referrerPolicy:'same-origin'});
      if(!response.ok)throw new Error(`ICE configuration status ${response.status}`);
      const {iceServers}=await response.json();
      if(!iceServers.some((server:RTCIceServer)=>String(server.urls).includes('turn:')))throw new Error('No TURN configured');
      const a=new RTCPeerConnection({iceServers,iceTransportPolicy:'relay'}),b=new RTCPeerConnection({iceServers,iceTransportPolicy:'relay'});
      const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;
      const ctx=canvas.getContext('2d')!;let green=false;
      const paint=()=>{ctx.fillStyle=green?'#00ff00':'#ff0000';ctx.fillRect(0,0,320,240);ctx.fillStyle='#fff';ctx.fillText('SYNTHETIC RELAY TEST',10,220);};
      paint();const interval=setInterval(paint,40),stream=canvas.captureStream(25);
      const video=document.createElement('video');video.autoplay=true;video.muted=true;video.playsInline=true;document.body.append(video);
      const queuedA:RTCIceCandidateInit[]=[],queuedB:RTCIceCandidateInit[]=[];
      const failures:string[]=[];
      a.onicecandidate=e=>{if(e.candidate){if(b.remoteDescription)void b.addIceCandidate(e.candidate).catch(()=>failures.push('ICE candidate rejected'));else queuedB.push(e.candidate.toJSON());}};
      b.onicecandidate=e=>{if(e.candidate){if(a.remoteDescription)void a.addIceCandidate(e.candidate).catch(()=>failures.push('ICE candidate rejected'));else queuedA.push(e.candidate.toJSON());}};
      b.ontrack=e=>{video.srcObject=e.streams[0];};
      stream.getTracks().forEach(track=>a.addTrack(track,stream));
      const channel=a.createDataChannel('synthetic-relay');let received=false;
      b.ondatachannel=e=>{e.channel.onmessage=event=>{received=event.data==='synthetic-relay-check';};};
      const wait=async(predicate:()=>boolean,label:string)=>{const until=Date.now()+45_000;while(!predicate()){if(Date.now()>until)throw new Error(`${label} timed out; states ${a.connectionState}/${b.connectionState}`);await new Promise(resolve=>setTimeout(resolve,100));}};
      try {
        await a.setLocalDescription(await a.createOffer());await b.setRemoteDescription(a.localDescription!);
        for(const candidate of queuedB.splice(0))await b.addIceCandidate(candidate);
        await b.setLocalDescription(await b.createAnswer());await a.setRemoteDescription(b.localDescription!);
        for(const candidate of queuedA.splice(0))await a.addIceCandidate(candidate);
        await wait(()=>a.connectionState==='connected'&&b.connectionState==='connected','Relay connection');
        await wait(()=>channel.readyState==='open','Data channel');channel.send('synthetic-relay-check');await wait(()=>received,'Relayed data');
        const pixel=()=>{if(!video.videoWidth)return [0,0];const sample=document.createElement('canvas');sample.width=1;sample.height=1;const c=sample.getContext('2d')!;c.drawImage(video,0,0,1,1);return Array.from(c.getImageData(0,0,1,1).data).slice(0,2);};
        await wait(()=>{const[r,g]=pixel();return r>150&&g<100;},'Red video frame');green=true;
        await wait(()=>{const[r,g]=pixel();return g>150&&r<100;},'Changed green video frame');
        const stats=await a.getStats();let pair:any;
        stats.forEach(report=>{if(report.type==='transport'&&report.selectedCandidatePairId)pair=stats.get(report.selectedCandidatePairId);});
        if(!pair)stats.forEach(report=>{if(report.type==='candidate-pair'&&report.nominated&&report.state==='succeeded')pair=report;});
        const local=pair&&stats.get(pair.localCandidateId),remote=pair&&stats.get(pair.remoteCandidateId);
        return {localCandidateType:local?.candidateType,remoteCandidateType:remote?.candidateType,bytesSent:pair?.bytesSent,bytesReceived:pair?.bytesReceived,videoWidth:video.videoWidth,videoHeight:video.videoHeight,dataReceived:received,changedFrames:true,failures};
      } finally {clearInterval(interval);stream.getTracks().forEach(track=>track.stop());a.close();b.close();video.remove();}
    },{token:session.token});
    expect(result.localCandidateType).toBe('relay');expect(result.remoteCandidateType).toBe('relay');
    expect(result.bytesSent).toBeGreaterThan(0);expect(result.bytesReceived).toBeGreaterThan(0);
    expect(result.videoWidth).toBe(320);expect(result.videoHeight).toBe(240);expect(result.dataReceived).toBe(true);expect(result.changedFrames).toBe(true);expect(result.failures).toEqual([]);
  }finally{await context.close();}
});
