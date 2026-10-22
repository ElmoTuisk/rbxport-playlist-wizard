import {readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isAbsolute,join} from 'node:path';
import {fileURLToPath} from 'node:url';
export const ESSENTIA_ANALYZER_VERSION='wizard-essentia-js-0.1.3-1';
export const essentiaDirectory=()=>process.env.ESSENTIA_DIR||fileURLToPath(new URL('../.runtime/essentia/',import.meta.url));
const checked=new Map();
export async function verifyEssentia(directory=essentiaDirectory()) {
  if(!isAbsolute(directory))throw Error('Essentia runtime needs an absolute installation directory');
  const manifest=JSON.parse(await readFile(new URL('../dependencies.json',import.meta.url),'utf8')).essentia;
  for(const [name,file] of Object.entries(manifest.files)) {
    const path=join(directory,name);let info;
    try{info=await stat(path);}catch{throw Error('Essentia is unavailable. Run Playlist Wizard setup again, or choose Basic analysis.');}
    const stamp=`${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
    if(checked.get(path)===stamp)continue;
    if(!info.isFile()||createHash('sha256').update(await readFile(path)).digest('hex')!==file.sha256)throw Error('Essentia checksum verification failed. Run Playlist Wizard setup again.');
    checked.set(path,stamp);
  }
  return {directory,version:manifest.version};
}
export async function essentiaStatus(){try{const {version}=await verifyEssentia();return {available:true,version};}catch(error){return {available:false,message:error.message};}}
