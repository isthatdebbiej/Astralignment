import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,utimesSync,statSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {artifactVerifier} from '../../gateway/curation/artifacts.js';
test('artifact verification rejects same-size mutation and never caches a failed hash',async()=>{
 mkdirSync('runtime',{recursive:true});
 const root=mkdtempSync(path.resolve('runtime/curation-hash-'));
 try{
  const filename=path.join(root,'source.bin'),original=Buffer.from('original');
  writeFileSync(filename,original);const stamp=statSync(filename);
  const artifact={id:'synthetic-fixture',bytes:original.length,sha256:createHash('sha256').update(original).digest('hex')};
  const verify=artifactVerifier();await verify(filename,artifact);
  writeFileSync(filename,'mutation');utimesSync(filename,stamp.atime,new Date(stamp.mtimeMs+1000));
  await assert.rejects(verify(filename,artifact),/checksum mismatch/);
  await assert.rejects(verify(filename,artifact),/checksum mismatch/);
  writeFileSync(filename,original);await verify(filename,artifact);
 }finally{rmSync(root,{recursive:true,force:true});}
});
