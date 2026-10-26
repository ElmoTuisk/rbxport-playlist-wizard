// Offline synthetic benchmark. No host, library, real music or network is used.
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {analyzeAudio} from '../src/analysis.mjs';
import {mapAnalysis,analysisParallelism} from '../src/analysis-queue.mjs';
import {verifyEssentia} from '../src/essentia-runtime.mjs';
import {run} from '../src/process.mjs';

const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
const count=Number(option('--tracks')||4),rounds=Number(option('--rounds')||2),duration=Number(option('--seconds')||300);
const format=option('--format')||'wav';if(!['wav','mp3'].includes(format))throw Error('Choose wav or mp3');
if(!Number.isInteger(count)||count<2||count>20||!Number.isInteger(rounds)||rounds<1||rounds>5||!Number.isFinite(duration)||duration<30||duration>600)throw Error('Use 2–20 tracks, 1–5 rounds and 30–600 seconds');
const ffmpeg=process.env.FFMPEG||'ffmpeg',runtime=await verifyEssentia();process.env.ESSENTIA_DIR=runtime.directory;
const baseline=option('--baseline-directory');
const legacy=baseline?(await import(pathToFileURL(join(resolve(baseline),'src/analysis.mjs')).href)).analyzeAudio:analyzeAudio;
const concurrency=analysisParallelism(),directory=await mkdtemp(join(tmpdir(),'wizard-analysis-benchmark-'));
const signature=result=>({...result,audioFeatures:{...result.audioFeatures,estimation:undefined}});
const descriptors=result=>({...signature(result),audioFeatures:{...signature(result).audioFeatures,rhythm:null,tonal:null,
  sections:Object.fromEntries(Object.entries(result.audioFeatures.sections).map(([name,s])=>[name,{...s,rhythm:null,tonal:null}]))},featureWarnings:[]});
const digest=async file=>createHash('sha256').update(await readFile(file)).digest('hex');
try {
  const files=[];
  for(let i=0;i<2;i++){
    const path=join(directory,`synthetic-${i}.${format}`),period=i?0.46875:0.5;
    const encoding=format==='mp3'?['-c:a','libmp3lame','-b:a','320k','-ac','2']:['-c:a','pcm_f32le'];
    await run(ffmpeg,['-v','error','-f','lavfi','-i',`aevalsrc=0.3*sin(2*PI*${i?330:220}*t)+0.5*exp(-35*mod(t\\,${period}))*sin(2*PI*90*t):s=44100:d=${duration}`,...encoding,path]);files.push(path);
  }
  const hashes=await Promise.all(files.map(digest)),items=Array.from({length:count},(_,i)=>files[i%files.length]),measurements=[];
  for(let round=0;round<rounds;round++) {
    let reference;
    for(const [name,analyzer,slots,estimate] of [['baseline-serial',legacy,1,true],['host-metadata-serial',analyzeAudio,1,false],['host-metadata-bounded',analyzeAudio,concurrency,false],['missing-metadata-bounded',analyzeAudio,concurrency,true]]) {
      const start=performance.now();let peakRss=process.memoryUsage().rss;
      const sampling=setInterval(()=>{peakRss=Math.max(peakRss,process.memoryUsage().rss);},25);
      let results;
      try {results=await mapAnalysis(items,path=>analyzer(path,{ffmpeg,duration,backend:'essentia',estimateBpm:estimate,estimateKey:estimate}),{concurrency:slots});}
      finally {clearInterval(sampling);}
      const seconds=(performance.now()-start)/1000;
      if(!reference)reference=results;
      else for(let i=0;i<results.length;i++)assert.deepEqual(estimate?signature(results[i]):descriptors(results[i]),estimate?signature(reference[i]):descriptors(reference[i]),'Descriptors changed');
      const row={round:round+1,name,format,tracks:count,trackSeconds:duration,slots,seconds:Number(seconds.toFixed(3)),peakNodeRssMiB:Math.round(peakRss/1024**2)};
      measurements.push(row);console.log(JSON.stringify(row));
    }
  }
  assert.deepEqual(await Promise.all(files.map(digest)),hashes,'Synthetic source bytes changed');
  const mean=name=>measurements.filter(m=>m.name===name).reduce((n,m)=>n+m.seconds,0)/rounds;
  console.log(JSON.stringify({summary:{runs:rounds,format,tracksPerRun:count,trackSeconds:duration,concurrency,baselineSeconds:mean('baseline-serial'),hostMetadataSeconds:mean('host-metadata-bounded'),missingMetadataSeconds:mean('missing-metadata-bounded'),speedupWithHostMetadata:mean('baseline-serial')/mean('host-metadata-bounded'),descriptorsEqual:true,sourceBytesUnchanged:true}}));
} finally {await rm(directory,{recursive:true,force:true});}
