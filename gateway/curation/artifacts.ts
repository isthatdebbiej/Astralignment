import {createReadStream,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
export function artifactVerifier(){
 const cache=new Map<string,Promise<void>>();
 let queue:Promise<void>=Promise.resolve(),pending=0;
 return async(filename:string,artifact:{id:string;sha256:string;bytes:number})=>{
   const stat=statSync(filename,{bigint:true});
   if(!stat.isFile()||stat.size!==BigInt(artifact.bytes))throw new Error('Artifact missing, non-regular or changed in size');
   const key=[filename,artifact.id,artifact.sha256,stat.size,stat.mtimeNs,stat.ctimeNs,stat.ino].join(':');
   const existing=cache.get(key);if(existing)return existing;
   if(pending>=16)throw Object.assign(new Error('Artifact verification queue is full; retry shortly'),{status:429});
   pending++;
   const task=queue.then(async()=>{
     const hash=createHash('sha256');
     for await(const block of createReadStream(filename))hash.update(block);
     if(hash.digest('hex')!==artifact.sha256)throw new Error('Artifact checksum mismatch; original evidence changed');
   });
   queue=task.catch(()=>{});
   cache.set(key,task);
   if(cache.size>128)cache.delete(cache.keys().next().value!);
   try{await task;}catch(error){cache.delete(key);throw error;}finally{pending--;}
 };
}
