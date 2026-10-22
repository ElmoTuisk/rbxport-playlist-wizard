import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {dirname,join,resolve} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const hash=data=>createHash('sha256').update(data).digest('hex');
export async function essentiaManifest(){return JSON.parse(await readFile(join(root,'dependencies.json'),'utf8')).essentia;}
// Extract only three pinned regular files. No tar paths are joined to a destination.
export function extractRuntime(archive,manifest) {
  if(hash(archive)!==manifest.sha256)throw Error('Essentia archive checksum mismatch');
  const tar=gunzipSync(archive,{maxOutputLength:64*1024*1024}),files=new Map();
  for(let offset=0;offset+512<=tar.length;) {
    const header=tar.subarray(offset,offset+512);if(header.every(byte=>byte===0))break;
    const name=header.subarray(0,100).toString('utf8').replace(/\0.*$/s,''),sizeText=header.subarray(124,136).toString('ascii').replace(/\0.*$/s,'').trim();
    if(!/^[0-7]+$/.test(sizeText))throw Error('Invalid Essentia archive header');
    const size=parseInt(sizeText,8),start=offset+512,end=start+size;
    if(end>tar.length)throw Error('Truncated Essentia archive');
    for(const [target,file] of Object.entries(manifest.files))if(name===file.entry) {
      if(files.has(target)||![0,48].includes(header[156])||hash(tar.subarray(start,end))!==file.sha256)throw Error('Essentia runtime file checksum/type mismatch');
      files.set(target,tar.subarray(start,end));
    }
    offset=start+Math.ceil(size/512)*512;
  }
  if(files.size!==Object.keys(manifest.files).length)throw Error('Essentia archive is missing required files');
  return files;
}
export async function installEssentia({directory=join(root,'.runtime','essentia'),archiveFile=join(root,'.install-cache','essentia.js-0.1.3.tgz'),fetchImpl=fetch}={}) {
  const manifest=await essentiaManifest();let archive;
  try{archive=await readFile(archiveFile);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(!archive) {
    const url=new URL(manifest.url);
    if(url.protocol!=='https:'||url.hostname!=='registry.npmjs.org')throw Error('Unexpected Essentia distribution source');
    const response=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(60000)});
    if(!response.ok)throw Error('Essentia download failed');
    const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>8*1024*1024)throw Error('Essentia download exceeded size limit');chunks.push(chunk);}
    archive=Buffer.concat(chunks);if(hash(archive)!==manifest.sha256)throw Error('Essentia download checksum mismatch');
    await mkdir(dirname(archiveFile),{recursive:true});await writeFile(archiveFile+'.partial',archive);await rename(archiveFile+'.partial',archiveFile);
  }
  const files=extractRuntime(archive,manifest);await mkdir(directory,{recursive:true});
  for(const [name,content] of files){await writeFile(join(directory,name)+'.partial',content);await rename(join(directory,name)+'.partial',join(directory,name));}
  return {version:manifest.version,files:files.size};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const value=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
  try{const result=await installEssentia({directory:value('--directory'),archiveFile:value('--archive')});console.log(`Essentia.js ${result.version} verified and ready for local analysis.`);}
  catch{console.error('Essentia setup failed: check internet access or the pinned archive checksums. No analysis runtime was executed.');process.exitCode=1;}
}
