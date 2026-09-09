import type {RequestHandler} from 'express';
import {createHmac,timingSafeEqual,randomBytes} from 'node:crypto';
const equal=(a:string,b:string)=>Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export function curationAccess(workerToken:string):RequestHandler{
 const configured=process.env.CURATION_PUBLIC_ORIGIN;
 const publicOrigin=configured?new URL(configured):null;
 const operator=process.env.CURATION_OPERATOR_TOKEN??'';
 if(publicOrigin&&(publicOrigin.protocol!=='https:'||publicOrigin.origin!==configured||operator.length<32))
   throw new Error('Remote curation requires an exact HTTPS origin and an operator token of at least 32 characters');
 const sign=(value:string)=>createHmac('sha256',operator).update(value).digest('hex');
 let attempts:number[]=[];
 return (req,res,next)=>{
   if(req.path.startsWith('/internal/')){
     if(!equal(req.get('authorization')??'','Bearer '+workerToken))return void res.status(401).json({error:'Worker authentication required'});
     return next();
   }
   const loopback=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress??'');
   const trustedProxy=loopback||process.env.CURATION_CONTAINER_LOCAL==='1';
   const origin=req.get('origin');
   if(publicOrigin){
     if(!trustedProxy||req.get('host')!==publicOrigin.host||req.get('x-forwarded-proto')!=='https'||
       (origin&&origin!==publicOrigin.origin)||req.get('sec-fetch-site')==='cross-site')
       return void res.status(403).json({error:'Use the configured HTTPS origin through the trusted local proxy'});
     const cookie=(req.get('cookie')??'').split(';').map(v=>v.trim()).find(v=>v.startsWith('curation_session='))?.slice(17)??'';
     const [expiry,nonce,signature]=cookie.split('.');
     const authenticated=!!expiry&&!!nonce&&!!signature&&Number(expiry)>Date.now()&&equal(signature,sign(expiry+'.'+nonce));
     if(req.path==='/auth'&&req.method==='GET')return void res.json({required:true,authenticated});
     if(req.path==='/auth'&&req.method==='POST'){
       attempts=attempts.filter(t=>Date.now()-t<60000);
       if(attempts.length>=10)return void res.status(429).json({error:'Too many login attempts; wait one minute'});
       attempts.push(Date.now());
       if(typeof req.body?.token!=='string'||!equal(req.body.token,operator))return void res.status(401).json({error:'Invalid operator token'});
       const payload=String(Date.now()+8*60*60*1000)+'.'+randomBytes(16).toString('hex');
       res.setHeader('Set-Cookie','curation_session='+payload+'.'+sign(payload)+'; Path=/api/v1; HttpOnly; Secure; SameSite=Strict; Max-Age=28800');
       return void res.json({authenticated:true});
     }
     if(!authenticated)return void res.status(401).json({error:'Operator authentication required'});
     if(req.path==='/auth'&&req.method==='DELETE'){
       res.setHeader('Set-Cookie','curation_session=; Path=/api/v1; HttpOnly; Secure; SameSite=Strict; Max-Age=0');
       return void res.json({authenticated:false});
     }
     return next();
   }
   let hostname='';try{hostname=new URL('http://'+req.get('host')).hostname;}catch{}
   if(!trustedProxy||!['localhost','127.0.0.1','[::1]'].includes(hostname)||
      (origin&&!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))||req.get('sec-fetch-site')==='cross-site')
     return void res.status(403).json({error:'Local-only curation service'});
   if(req.path==='/auth'&&req.method==='GET')return void res.json({required:false,authenticated:true});
   next();
 };
}
