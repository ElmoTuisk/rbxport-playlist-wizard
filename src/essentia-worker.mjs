import {parentPort,workerData} from 'node:worker_threads';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {verifyEssentia} from './essentia-runtime.mjs';
import {analyzeExcerpts} from './essentia-features.mjs';
let e;
// Analysis never fetches remote audio/models or inherits parent CLI preloads.
globalThis.fetch=()=>Promise.reject(Error('Analysis worker network fetch is disabled'));
try {
  const {directory}=await verifyEssentia(workerData.directory),require=createRequire(import.meta.url);
  const wasm=require(join(directory,'essentia-wasm.cjs')),Core=require(join(directory,'essentia-core.cjs'));
  e=new Core(wasm.EssentiaWASM||wasm);parentPort.postMessage({result:analyzeExcerpts(e,workerData.excerpts,workerData.options)});
}catch{parentPort.postMessage({error:'Essentia could not analyze these excerpts. No heuristic substitution was made.'});}
finally{if(e){try{e.shutdown();e.delete();}catch{}}}
