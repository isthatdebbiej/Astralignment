export const PAIRING_KEY='astralignment.cameraPairing.v1';
export type SavedPairing={token:string;expiresAt:number};
export function readPairing(storage:Pick<Storage,'getItem'|'removeItem'>,now=Date.now()):SavedPairing|null{
  try{const value=JSON.parse(storage.getItem(PAIRING_KEY)||'null');if(value&&/^[A-Za-z0-9_-]{32}$/.test(value.token)&&Number.isFinite(value.expiresAt)&&value.expiresAt>now)return {token:value.token,expiresAt:value.expiresAt};storage.removeItem(PAIRING_KEY);}catch{}return null;
}
export function savePairing(storage:Pick<Storage,'setItem'>,pairing:SavedPairing){try{storage.setItem(PAIRING_KEY,JSON.stringify(pairing));}catch{}}
