import test from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { createServer } from 'node:http';
import { once } from 'node:events';
import express from 'express';
import { allowedOrigin, authorized, operatorOnly, registerAuth } from '../../gateway/auth';

test('operator auth rejects foreign origins and spoofed public requests; public unlock requires valid cookie', async () => {
  const previousOrigin = process.env.PUBLIC_ORIGIN, previousToken = process.env.ASTRA_OPERATOR_TOKEN;
  const request = (host: string, origin?: string, address='127.0.0.1') => ({ headers: {host, ...(origin?{origin}:{})}, socket:{remoteAddress:address} } as IncomingMessage);
  const app=express(); app.use(express.json()); registerAuth(app); app.get('/protected',operatorOnly,(_req,res)=>res.json({ok:true}));
  const server=createServer(app);
  try {
    delete process.env.PUBLIC_ORIGIN;
    assert.equal(authorized(request('localhost:8787','http://localhost:5173')),true);
    assert.equal(allowedOrigin(request('localhost:8787','https://foreign.example')),false);
    assert.equal(authorized(request('localhost:8787','https://foreign.example')),false);
    assert.equal(authorized(request('public.example')),false);
    assert.equal(authorized(request('localhost:8787',undefined,'203.0.113.10')),false);
    process.env.PUBLIC_ORIGIN='https://astra.test'; process.env.ASTRA_OPERATOR_TOKEN='synthetic-test-token-not-a-secret';
    assert.equal(authorized(request('localhost:8787')),false);
    server.listen(0,'127.0.0.1'); await once(server,'listening');
    const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
    assert.equal((await fetch(`${base}/protected`)).status,401);
    assert.equal((await fetch(`${base}/api/auth`,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://foreign.example'},body:JSON.stringify({token:process.env.ASTRA_OPERATOR_TOKEN})})).status,403);
    const login=await fetch(`${base}/api/auth`,{method:'POST',headers:{'Content-Type':'application/json',Origin:process.env.PUBLIC_ORIGIN},body:JSON.stringify({token:process.env.ASTRA_OPERATOR_TOKEN})});
    assert.equal(login.status,200);
    const setCookie=login.headers.get('set-cookie')!;
    assert.match(setCookie,/HttpOnly/i); assert.match(setCookie,/SameSite=Strict/i); assert.match(setCookie,/Secure/i);
    const cookie=setCookie.split(';')[0];
    assert.equal((await fetch(`${base}/protected`,{headers:{Cookie:cookie,Origin:process.env.PUBLIC_ORIGIN}})).status,200);
    assert.equal((await fetch(`${base}/protected`,{headers:{Cookie:cookie,Origin:'https://foreign.example'}})).status,401);
    for(let i=0;i<10;i++) assert.equal((await fetch(`${base}/api/auth`,{method:'POST',headers:{'Content-Type':'application/json',Origin:process.env.PUBLIC_ORIGIN},body:'{"token":"incorrect-synthetic-test"}'})).status,401);
    assert.equal((await fetch(`${base}/api/auth`,{method:'POST',headers:{'Content-Type':'application/json',Origin:process.env.PUBLIC_ORIGIN},body:'{"token":"incorrect-synthetic-test"}'})).status,429);
  } finally {
    server.close();
    if(previousOrigin===undefined) delete process.env.PUBLIC_ORIGIN; else process.env.PUBLIC_ORIGIN=previousOrigin;
    if(previousToken===undefined) delete process.env.ASTRA_OPERATOR_TOKEN; else process.env.ASTRA_OPERATOR_TOKEN=previousToken;
  }
});
