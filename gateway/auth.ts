import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Express, RequestHandler } from 'express';
const sessions = new Map<string, number>();
const digest = (s: string) => createHash('sha256').update(s).digest();
const same = (a: string,b: string) => timingSafeEqual(digest(a),digest(b));
function local(req: IncomingMessage) {
  return ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '') && /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(req.headers.host || '') && !process.env.PUBLIC_ORIGIN;
}
export function allowedOrigin(req: IncomingMessage) {
  const origin = req.headers.origin;
  if (!origin) return true; // Non-browser clients still require authentication on public hosts.
  if (process.env.PUBLIC_ORIGIN) return origin === process.env.PUBLIC_ORIGIN;
  try { return local(req) && ['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname); } catch { return false; }
}
export function authorized(req: IncomingMessage) {
  if (!allowedOrigin(req)) return false;
  if (local(req)) return true;
  const cookie = (req.headers.cookie || '').split(';').map(c=>c.trim()).find(c=>c.startsWith('astra_session='))?.slice(14);
  return !!cookie && (sessions.get(cookie) || 0) > Date.now();
}
export const operatorOnly: RequestHandler = (req,res,next) => {
  if (!authorized(req)) return res.status(401).json({error:'Operator access required. Unlock with the deployment access token.',auth_required:true});
  next();
};
export function registerAuth(app: Express) {
  const failures = new Map<string,{count:number,until:number}>();
  app.post('/api/auth',(req,res)=>{
    if (!allowedOrigin(req)) return res.status(403).json({error:'Origin rejected'});
    const address = req.socket.remoteAddress || 'unknown';
    const fail = failures.get(address);
    if (fail && fail.until > Date.now() && fail.count >= 10) return res.status(429).json({error:'Too many unlock attempts; retry in one minute'});
    const expected = process.env.ASTRA_OPERATOR_TOKEN;
    if (!expected || typeof req.body?.token !== 'string' || !same(req.body.token,expected)) {
      failures.set(address,{count:fail && fail.until > Date.now() ? fail.count+1 : 1,until:Date.now()+60000});
      return res.status(401).json({error:'Invalid deployment access token'});
    }
    failures.delete(address);
    const token = randomBytes(32).toString('base64url');
    sessions.set(token,Date.now()+8*60*60*1000);
    res.cookie('astra_session',token,{httpOnly:true,sameSite:'strict',secure:!!process.env.PUBLIC_ORIGIN?.startsWith('https:'),maxAge:8*60*60*1000,path:'/'});
    return res.json({ok:true});
  });
}
