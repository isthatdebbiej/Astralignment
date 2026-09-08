import test from 'node:test';
import assert from 'node:assert/strict';
import { ephemeralTurnCredentials, registerCamera, validCalibration, validSignal } from '../../gateway/camera.js';
import { createHmac } from 'node:crypto';
import express from 'express';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { once } from 'node:events';
import { createFloorMapping } from '../../web/src/camera/homography.js';
import { projectFootprint } from '../../web/src/camera/ObstacleAnnotation.js';
test('camera accepts bounded SDP and ICE messages only', () => {
  assert.equal(validSignal({ type: 'offer', sdp: 'v=0' }), true);
  assert.equal(validSignal({ type: 'candidate', candidate: { candidate: 'candidate:1' } }), true);
  assert.equal(validSignal({ type: 'stop' }), true);
  for (const value of [null, 'offer', {}, { type: 'eval', code: 'x' }, { type: 'offer', sdp: 4 }, { type: 'answer', sdp: 'x'.repeat(100_000) }, { type: 'candidate', candidate: 'bad' }]) assert.equal(validSignal(value), false);
});
test('TURN credentials use expiry HMAC without exposing the shared secret',()=>{
  const secret='synthetic-coturn-test-secret',now=1_800_000_000_000;
  const ice=ephemeralTurnCredentials(secret,['turn:relay.example:3478?transport=udp'],now+90_000,now);
  assert.equal(Number(ice.username.split(':')[0]),Math.floor((now+90_000)/1000));
  assert.equal(ice.credential,createHmac('sha1',secret).update(ice.username).digest('base64'));
  assert.equal(JSON.stringify(ice).includes(secret),false);
  const capped=ephemeralTurnCredentials(secret,['turns:relay.example:5349'],now+99_999_999,now);
  assert.equal(Number(capped.username.split(':')[0]),Math.floor((now+30*60_000)/1000));
  assert.throws(()=>ephemeralTurnCredentials(secret,['https://relay.example'],now+90_000,now));
  assert.throws(()=>ephemeralTurnCredentials(secret,['turn:relay.example'],now,now));
});
test('pairing binds origin, rejects expired tokens and signals late join/disconnect', async () => {
  const app = express(), server = createServer(app);
  app.use(express.json());
  registerCamera(app, server, { sessionTtlMs: 700 });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address() as { port: number }, base = `http://127.0.0.1:${address.port}`, origin = process.env.PUBLIC_ORIGIN || base;
  const sockets: WebSocket[] = [];
  const open = (token: string, role: string, peerOrigin = origin) => { const ws = new WebSocket(`${base.replace('http', 'ws')}/ws/camera?token=${token}&role=${role}`, { origin: peerOrigin }); sockets.push(ws); return ws; };
  const rejected = (ws: WebSocket) => new Promise<number>((resolve, reject) => { ws.on('unexpected-response', (_req, response) => { response.resume(); resolve(response.statusCode!); }); ws.on('open', () => reject(new Error('Unexpected accepted peer'))); ws.on('error', () => {}); });
  try {
    const response = await fetch(`${base}/api/camera/session`, { method: 'POST', headers: { Origin: origin } });
    const { token } = await response.json() as { token: string };
    assert.match(token, /^[\w-]{32}$/);
    assert.equal((await fetch(`${base}/api/camera/config`)).status, 403);
    assert.equal((await fetch(`${base}/api/camera/config`, { headers: { Authorization: `Bearer ${token}`, Origin: origin } })).status, 200);
    assert.equal((await fetch(`${base}/api/camera/config`, { headers: { Authorization: `Bearer ${token}`, Origin: 'https://wrong.example' } })).status, 403);
    assert.equal(await rejected(open(token, 'viewer', 'https://wrong.example')), 403);
    const viewer = open(token, 'viewer'); const ready = once(viewer, 'message'); await once(viewer, 'open');
    assert.equal(JSON.parse(String((await ready)[0])).peerConnected, false);
    const joined = once(viewer, 'message'), phone = open(token, 'phone'); await once(phone, 'open');
    assert.equal(JSON.parse(String((await joined)[0])).type, 'peer-connected');
    const offer = once(viewer, 'message'); phone.send(JSON.stringify({ type: 'offer', sdp: 'v=0' }));
    assert.equal(JSON.parse(String((await offer)[0])).type, 'offer');
    const disconnected = once(viewer, 'message'); phone.close();
    assert.equal(JSON.parse(String((await disconnected)[0])).type, 'peer-disconnected');
    await new Promise(resolve => setTimeout(resolve, 750));
    assert.equal((await fetch(`${base}/api/camera/config`, { headers: { Authorization: `Bearer ${token}`, Origin: origin } })).status, 403);
    assert.equal(await rejected(open(token, 'phone')), 403);
  } finally { sockets.forEach(ws => { if (ws.readyState === WebSocket.OPEN) ws.terminate(); }); server.close(); }
});
test('floor homography maps perspective corners to centered meters and round trips interior points', () => {
  const corners: [number,number][] = [[.1,.9],[.9,.8],[.7,.1],[.3,.15]];
  const map = createFloorMapping(corners, 8, 6), expected = [[-4,-3],[4,-3],[4,3],[-4,3]];
  corners.forEach((p,i)=>map.toWorld(p).forEach((v,j)=>assert.ok(Math.abs(v-expected[i][j])<1e-8)));
  const p: [number,number]=[.45,.5], round=map.toImage(map.toWorld(p));
  round.forEach((v,i)=>assert.ok(Math.abs(v-p[i])<1e-8));
  assert.throws(()=>createFloorMapping([[0,0],[1,1],[1,0],[0,1]],8,6));
  assert.throws(()=>createFloorMapping(corners,0,6));
});
test('manual obstacle ground corners project into bounded world box',()=>{
  const calibration={width:8,depth:6,corners:[[0,1],[1,1],[1,0],[0,0]] as [number,number][],captured_at:new Date().toISOString(),frame_width:640,frame_height:480};
  const box=projectFootprint(calibration,[[.25,.75],[.5,.5]],.8);
  assert.deepEqual(box.position,[-1,-.75]);assert.deepEqual(box.size,[2,1.5,.8]);
  assert.throws(()=>projectFootprint(calibration,[[.25,.75],[.25,.5]],.8));
  assert.throws(()=>projectFootprint(calibration,[[.25,.75],[.5,.5]],NaN));
  assert.throws(()=>projectFootprint(calibration,[[-1,0],[.5,.5]],.8));
});
test('calibration accepts measured convex quadrilateral, rejects crossed and degenerate corners', () => {
  const value = { width: 4, depth: 3, captured_at: new Date().toISOString(), frame_width: 1280, frame_height: 720, corners: [[0,0], [1,0], [1,1], [0,1]] };
  assert.equal(validCalibration(value), true);
  assert.equal(validCalibration({ ...value, width: Infinity }), false);
  assert.equal(validCalibration({ ...value, corners: [[0,0],[1,1],[1,0],[0,1]] }), false);
  assert.equal(validCalibration({ ...value, corners: [[0,0],[0,0],[0,0],[0,0]] }), false);
});
