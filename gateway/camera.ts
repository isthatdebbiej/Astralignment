import { createHmac, randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import type { Express } from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import type { CameraCalibration } from '../contracts/index.js';

type Session = { expires: number; origin: string; phone?: WebSocket; viewer?: WebSocket };
const TTL = 30 * 60_000;
export function ephemeralTurnCredentials(secret:string,urls:string[],sessionExpires:number,now=Date.now()) {
  if(!secret||!urls.length||urls.some(url=>!/^turns?:[^\s]+$/i.test(url)))throw new Error('TURN secret and valid TURN URLs required');
  const expires=Math.floor(Math.min(sessionExpires,now+TTL)/1000);
  if(expires<=Math.floor(now/1000))throw new Error('Pairing expired');
  const username=`${expires}:${randomBytes(8).toString('hex')}`;
  return {urls,username,credential:createHmac('sha1',secret).update(username).digest('base64'),credentialType:'password' as const};
}
export function validSignal(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (v.type === 'offer' || v.type === 'answer') ? typeof v.sdp === 'string' && v.sdp.length < 100_000
    : v.type === 'candidate' ? (v.candidate === null || (typeof v.candidate === 'object' && typeof (v.candidate as any).candidate === 'string'))
    : v.type === 'stop';
}
export function validCalibration(v: any): v is CameraCalibration {
  if (!v || !Number.isFinite(v.width) || !Number.isFinite(v.depth) || v.width < 0.1 || v.depth < 0.1 || v.width > 100 || v.depth > 100 || !Number.isInteger(v.frame_width) || !Number.isInteger(v.frame_height) || v.frame_width < 1 || v.frame_height < 1 || v.frame_width > 8192 || v.frame_height > 8192 || typeof v.captured_at !== 'string' || !Number.isFinite(Date.parse(v.captured_at)) || !Array.isArray(v.corners) || v.corners.length !== 4) return false;
  if (!v.corners.every((p: any) => Array.isArray(p) && p.length === 2 && p.every((n: any) => Number.isFinite(n) && n >= 0 && n <= 1))) return false;
  const cross = v.corners.map((p: number[], i: number) => { const q = v.corners[(i + 1) % 4], r = v.corners[(i + 2) % 4]; return (q[0]-p[0])*(r[1]-q[1])-(q[1]-p[1])*(r[0]-q[0]); });
  return cross.every((n: number) => n > 0.0001) || cross.every((n: number) => n < -0.0001);
}
export function registerCamera(app: Express, server: Server, options: { onCalibration?: (value: CameraCalibration) => void | Promise<void>; sessionTtlMs?: number } = {}) {
  let calibration: CameraCalibration | null = null;
  app.get('/api/camera/calibration', (_req, res) => res.json({ calibration }));
  app.post('/api/camera/calibration', async (req, res) => {
    if (req.body?.confirmed !== true || !validCalibration(req.body.calibration)) return res.status(400).json({ error: 'Confirm four convex floor corners and valid measured dimensions' });
    const v = req.body.calibration as CameraCalibration;
    const next: CameraCalibration = { corners: v.corners.map(p => [p[0], p[1]]), width: v.width, depth: v.depth, frame_width: v.frame_width, frame_height: v.frame_height, captured_at: v.captured_at };
    try { await options.onCalibration?.(next); calibration = next; return res.json({ calibration }); }
    catch { return res.status(503).json({ error: 'Could not apply measured stage geometry' }); }
  });
  const sessions = new Map<string, Session>();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 128 * 1024 });
  const send = (ws: WebSocket | undefined, value: unknown) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value)); };
  app.post('/api/camera/session', (req, res) => {
    const origin = req.headers.origin;
    if (!origin || !/^https?:\/\//.test(origin)) return res.status(403).json({ error: 'A browser origin is required' });
    const expected = process.env.PUBLIC_ORIGIN;
    if (expected && origin !== expected) return res.status(403).json({ error: 'Origin rejected' });
    if (sessions.size >= 500) return res.status(429).json({ error: 'Session capacity reached' });
    const token = randomBytes(24).toString('base64url');
    const expires = Date.now() + Math.min(TTL, options.sessionTtlMs ?? TTL);
    sessions.set(token, { origin, expires });
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ token, expiresAt: expires });
  });
  app.get('/api/camera/config', (req, res) => {
    const token = req.headers.authorization?.match(/^Bearer ([\w-]+)$/)?.[1];
    const session = token ? sessions.get(token) : undefined;
    let origin = req.headers.origin;
    if (!origin && req.headers.referer) { try { origin = new URL(req.headers.referer).origin; } catch { /* rejected below */ } }
    if (!session || session.expires <= Date.now() || origin !== session.origin) return res.status(403).json({ error: 'Valid same-origin pairing required' });
    let iceServers: unknown[] = [];
    try { iceServers = JSON.parse(process.env.CAMERA_ICE_SERVERS || '[]'); } catch { /* empty is explicit LAN only */ }
    if(!Array.isArray(iceServers))iceServers=[];
    if(process.env.CAMERA_TURN_SECRET&&process.env.CAMERA_TURN_URLS){
      try {
        const raw=process.env.CAMERA_TURN_URLS.trim();
        const urls=raw.startsWith('[')?JSON.parse(raw):raw.split(',').map(url=>url.trim()).filter(Boolean);
        if(!Array.isArray(urls)||urls.some(url=>typeof url!=='string'))throw new Error('Invalid TURN URLs');
        iceServers.push(ephemeralTurnCredentials(process.env.CAMERA_TURN_SECRET,urls,session.expires));
      }catch{return res.status(503).json({error:'TURN configuration is invalid; contact the operator'});}
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ iceServers, warning: iceServers.length ? 'STUN alone cannot connect every network. Configure TURN for reliable remote access.' : 'LAN only: no STUN/TURN configured.' });
  });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname !== '/ws/camera') return;
    const session = sessions.get(url.searchParams.get('token') || '');
    const role = url.searchParams.get('role');
    if (!session || session.expires <= Date.now() || req.headers.origin !== session.origin || (role !== 'phone' && role !== 'viewer')) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return;
    }
    wss.handleUpgrade(req, socket, head, ws => {
      session[role]?.close(4001, 'Replaced by another peer');
      session[role] = ws;
      const other = () => session[role === 'phone' ? 'viewer' : 'phone'];
      send(ws, { type: 'ready', peerConnected: !!other() });
      send(other(), { type: 'peer-connected' });
      let windowStart = Date.now(), count = 0;
      ws.on('message', raw => {
        if (Date.now() - windowStart > 10_000) { count = 0; windowStart = Date.now(); }
        if (++count > 250) { ws.close(1008, 'Rate limit'); return; }
        try { const value: unknown = JSON.parse(raw.toString()); if (!validSignal(value)) { ws.close(1008, 'Invalid signaling message'); return; } send(other(), value); }
        catch { ws.close(1008, 'Invalid JSON'); }
      });
      ws.on('close', () => { if (session[role] === ws) { delete session[role]; send(other(), { type: 'peer-disconnected' }); } });
    });
  });
  const timer = setInterval(() => { for (const [token, session] of sessions) if (session.expires <= Date.now()) { session.phone?.close(4003, 'Session expired'); session.viewer?.close(4003, 'Session expired'); sessions.delete(token); } }, 10_000);
  timer.unref();
  server.on('close', () => { clearInterval(timer); wss.close(); });
}
