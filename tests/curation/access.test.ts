import test from 'node:test';
import assert from 'node:assert/strict';
import {curationAccess} from '../../gateway/curation/access.js';
test('remote curation fails closed and authenticates signed HTTPS sessions',()=>{
 const previousOrigin=process.env.CURATION_PUBLIC_ORIGIN,previousToken=process.env.CURATION_OPERATOR_TOKEN;
 try{
 process.env.CURATION_PUBLIC_ORIGIN='http://invalid.example';
 process.env.CURATION_OPERATOR_TOKEN='fixture-token-that-is-at-least-32-characters';
 assert.throws(()=>curationAccess('worker'),/HTTPS/);
 process.env.CURATION_PUBLIC_ORIGIN='https://curation.example';
 const access=curationAccess('worker');
 function invoke(path:string,method='GET',body:any={},extra:Record<string,string>={}){
 const headers:Record<string,string>={host:'curation.example','x-forwarded-proto':'https',...extra};
 const result:any={status:200,headers:{},next:false};
 const req:any={path,method,body,socket:{remoteAddress:'127.0.0.1'},get:(key:string)=>headers[key]};
 const res:any={status:(n:number)=>{result.status=n;return res;},json:(data:any)=>{result.body=data;return res;},setHeader:(key:string,value:string)=>{result.headers[key]=value;}};
 access(req,res,()=>{result.next=true;});return result;
 }
 assert.equal(invoke('/sources').status,401);
 assert.equal(invoke('/auth').body.authenticated,false);
 assert.equal(invoke('/auth','POST',{token:'bad'}).status,401);
 assert.equal(invoke('/auth','POST',{token:process.env.CURATION_OPERATOR_TOKEN},{origin:'https://evil.example'}).status,403);
 assert.equal(invoke('/auth','POST',{token:process.env.CURATION_OPERATOR_TOKEN},{'x-forwarded-proto':'http'}).status,403);
 const login=invoke('/auth','POST',{token:process.env.CURATION_OPERATOR_TOKEN});
 assert.equal(login.status,200);
 const cookie=login.headers['Set-Cookie'].split(';')[0];
 assert.match(login.headers['Set-Cookie'],/HttpOnly; Secure; SameSite=Strict/);
 assert.equal(invoke('/sources','GET',{}, {cookie}).next,true);
 assert.equal(invoke('/artifacts/example','GET',{}, {cookie:cookie+'tamper'}).status,401);
 assert.equal(invoke('/auth','DELETE',{}, {cookie}).body.authenticated,false);
 assert.equal(invoke('/internal/claim','POST',{}, {authorization:'Bearer worker'}).next,true);
 }finally{
 if(previousOrigin===undefined)delete process.env.CURATION_PUBLIC_ORIGIN;else process.env.CURATION_PUBLIC_ORIGIN=previousOrigin;
 if(previousToken===undefined)delete process.env.CURATION_OPERATOR_TOKEN;else process.env.CURATION_OPERATOR_TOKEN=previousToken;
 }
});
