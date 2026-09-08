import test from 'node:test';
import assert from 'node:assert/strict';
import {readPairing,savePairing,PAIRING_KEY} from '../../web/src/camera/pairing';
test('private tab pairing survives reload reads and clears invalid or expired records',()=>{
  const map=new Map<string,string>(),storage={getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v);},removeItem:(k:string)=>{map.delete(k);}};
  const pairing={token:'aB_-'.repeat(8),expiresAt:2000};
  savePairing(storage,pairing);assert.deepEqual(readPairing(storage,1000),pairing);
  assert.equal(readPairing(storage,2000),null);assert.equal(map.has(PAIRING_KEY),false);
  storage.setItem(PAIRING_KEY,JSON.stringify({...pairing,token:'invalid'}));assert.equal(readPairing(storage,1000),null);
  storage.setItem(PAIRING_KEY,'broken');assert.equal(readPairing(storage,1000),null);
});
