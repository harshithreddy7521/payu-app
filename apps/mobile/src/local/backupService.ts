import {admin,checkPassword,lock} from './api';
import {all,put,clear,tx,id,randomBytes} from './repository';
import {TABLES,Snapshot,validateSnapshot} from './schema';
import {seal,unseal} from './crypto';
async function authorise(token:string,password:string){const user=await admin(token);if(!await checkPassword(user,password))throw new Error('Administrator password is incorrect.');return user;}
export async function exportEncrypted(token:string,password:string,passphrase:string){const user=await authorise(token,password);const snapshot=await tx(async()=>{const tables={} as Snapshot['tables'];for(const t of TABLES)tables[t]=await all(t);await put('audit',{id:id(),action:'BACKUP_EXPORTED',userId:user.id,at:new Date().toISOString()});return validateSnapshot({version:1,tables});});return seal(snapshot,passphrase,randomBytes(16),randomBytes(12));}
export async function restoreEncrypted(token:string,password:string,passphrase:string,text:string){const user=await authorise(token,password);const snapshot=validateSnapshot(await unseal(text,passphrase));await tx(async()=>{await authorise(token,password);for(const t of TABLES){await clear(t);for(const row of snapshot.tables[t])await put(t,row);}await put('audit',{id:id(),action:'BACKUP_RESTORED',previousAdminId:user.id,at:new Date().toISOString()});});lock();}
