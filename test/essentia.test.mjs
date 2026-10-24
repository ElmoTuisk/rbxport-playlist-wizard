import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {analyzeAudio} from '../src/analysis.mjs';
import {ExcerptCollector,runEssentiaWorker} from '../src/essentia-analysis.mjs';
import {ESSENTIA_ANALYZER_VERSION,essentiaStatus,essentiaDirectory,verifyEssentia} from '../src/essentia-runtime.mjs';
import {keySummary,rhythmSummary,energyFromDescriptors} from '../src/essentia-features.mjs';
import {applyAnalysis} from '../src/track-features.mjs';
import {installEssentia,extractRuntime,essentiaManifest} from '../scripts/Install-Essentia.mjs';
import {run} from '../src/process.mjs';
const runtime=await essentiaStatus(),ffmpeg=process.env.FFMPEG||'ffmpeg',hasFFmpeg=spawnSync(ffmpeg,['-version'],{windowsHide:true}).status===0;
const temp=async t=>{const dir=await mkdtemp(join(tmpdir(),'wizard-essentia-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;};
const archivePath=fileURLToPath(new URL('../.install-cache/essentia.js-0.1.3.tgz',import.meta.url));
let archive;try{archive=await readFile(archivePath);}catch{}
const sha=data=>createHash('sha256').update(data).digest('hex');

test('Essentia excerpt collection is bounded, keeps real section positions and checks decoded duration',()=>{
  const c=new ExcerptCollector(90,8),samples=Float32Array.from({length:720},(_,i)=>i);
  c.push(samples.subarray(0,123));c.push(samples.subarray(123));const result=c.finish();
  assert.deepEqual(result.coverage,{intro:{start:0,seconds:30},body:{start:30,seconds:30},outro:{start:60,seconds:30}});
  assert.equal(result.excerpts.body[0],240);assert.equal(result.excerpts.outro.at(-1),719);
  assert.equal(Object.values(c.windows).reduce((n,w)=>n+w.data.length,0),720);
  assert.throws(()=>new ExcerptCollector(1801),/at most 30/);
  assert.throws(()=>new ExcerptCollector(10).push(new Float32Array([NaN])),/Invalid/);
  const short=new ExcerptCollector(90,8);short.push(new Float32Array(8));assert.throws(()=>short.finish(),/duration differs/);
  const tooLong=new ExcerptCollector(1800,8);assert.throws(()=>tooLong.push(new Float32Array(8*1801)),/30-minute track limit/);
});

test('Essentia raw strengths are gated, unsupported energy stays unknown and host metadata wins',()=>{
  const intervals=Array(20).fill(0.5),r=rhythmSummary({bpm:120,confidence:3.4},intervals);
  assert.equal(r.acceptedBpm,120);assert.equal(r.confidence,3.4);assert.equal(r.regularity,1);
  assert.equal(rhythmSummary({bpm:120,confidence:0},intervals).acceptedBpm,null);
  assert.equal(rhythmSummary({bpm:120,confidence:5},[0.3,0.9,0.4,0.8]).acceptedBpm,null);
  assert.equal(keySummary({key:'A',scale:'minor',strength:0.59}).acceptedKey,null);
  assert.equal(keySummary({key:'A',scale:'minor',strength:0.8}).acceptedKey,'Am');
  assert.equal(energyFromDescriptors({onsetRate:2}),null);assert.equal(energyFromDescriptors({silent:true}),1);
  const analysis={energy:7,evidence:'essentia-excerpt-estimate',audioFeatures:{backend:'essentia',rhythm:r,tonal:{key:'Am',strength:0.8}}};
  const filled=applyAnalysis({bpm:null,key:''},analysis);assert.equal(filled.bpm,120);assert.equal(filled.key,'Am');assert.equal(filled.bpmEvidence,'Essentia excerpt estimate');
  const retained=applyAnalysis({bpm:150,key:'Cm'},analysis,9);assert.equal(retained.bpm,150);assert.equal(retained.key,'Cm');assert.equal(retained.energy,9);assert.equal(retained.featureWarnings.length,2);
  const weak=applyAnalysis({bpm:null,key:''},{audioFeatures:{rhythm:{bpm:120,confidence:0,regularity:1,acceptedBpm:120},tonal:{key:'Am',strength:0.1,acceptedKey:'Am'}}});assert.equal(weak.bpm,null);assert.equal(weak.key,'');
});

test('pinned Essentia setup uses cached verified files, survives update and rejects modified archives',{skip:!archive},async t=>{
  const dir=await temp(t),runtimeDir=join(dir,'runtime'),cached=join(dir,'archive.tgz');await writeFile(cached,archive);
  const forbidden=()=>{throw Error('Fixture forbids network');};
  const manifest=await essentiaManifest(),files=extractRuntime(archive,manifest);assert.equal(files.size,3);
  await installEssentia({directory:runtimeDir,archiveFile:cached,fetchImpl:forbidden});await writeFile(join(dir,'saved-settings'),'fixture');
  await installEssentia({directory:runtimeDir,archiveFile:cached,fetchImpl:forbidden});assert.equal(await readFile(join(dir,'saved-settings'),'utf8'),'fixture');
  for(const [name,data] of files)assert.equal(sha(await readFile(join(runtimeDir,name))),sha(data));
  await verifyEssentia(runtimeDir);await writeFile(join(runtimeDir,'essentia-core.cjs'),'tampered');await assert.rejects(verifyEssentia(runtimeDir),/checksum/);
  const damaged=Buffer.from(archive);damaged[10]^=1;await writeFile(cached,damaged);await assert.rejects(installEssentia({directory:runtimeDir,archiveFile:cached,fetchImpl:forbidden}),/checksum/);
  await assert.rejects(verifyEssentia(join(dir,'missing')),/unavailable/);
  await assert.rejects(installEssentia({directory:runtimeDir,archiveFile:join(dir,'absent.tgz'),fetchImpl:forbidden,offline:true}),/Offline setup will not download/);
});

test('real Essentia worker analyzes synthetic pulse audio, resists gain changes and preserves source bytes',{skip:!runtime.available||!hasFFmpeg,timeout:30000},async t=>{
  const dir=await temp(t),a=join(dir,'pulse.wav'),b=join(dir,'quiet.wav');
  const expression='0.3*sin(2*PI*220*t)+0.5*exp(-35*mod(t\\,0.5))*sin(2*PI*90*t)';
  await run(ffmpeg,['-v','error','-f','lavfi','-i',`aevalsrc=${expression}:s=44100:d=12`,'-c:a','pcm_f32le',a]);
  await run(ffmpeg,['-v','error','-i',a,'-af','volume=0.2','-c:a','pcm_f32le',b]);
  const before=sha(await readFile(a)),options={ffmpeg,backend:'essentia',duration:12};
  const loud=await analyzeAudio(a,options),quiet=await analyzeAudio(b,options);
  assert.equal(loud.version,ESSENTIA_ANALYZER_VERSION);assert.equal(loud.evidence,'essentia-excerpt-estimate');assert.equal(sha(await readFile(a)),before);
  assert(Math.abs(loud.energy-quiet.energy)<=0.2);assert(loud.energy>=1&&loud.energy<=10);
  const f=loud.audioFeatures;assert.equal(f.backend,'essentia');assert.equal(f.decodedSeconds,12);assert(Math.abs(f.rhythm.bpm-120)<2);assert(f.rhythm.confidence>1.5);assert(f.rhythm.acceptedBpm);
  assert(f.sections.body.onsetRate>0);assert(Number.isFinite(f.sections.body.centroidHz));assert(Number.isFinite(f.sections.body.dynamicComplexity));assert(f.tonal.key);assert(Number.isFinite(f.tonal.strength));
  assert(Math.abs((quiet.audioFeatures.sections.body.loudnessDb-f.sections.body.loudnessDb)+13.9794)<0.2);
  const bad=join(dir,'bad.mp3');await writeFile(bad,'not audio');await assert.rejects(analyzeAudio(bad,options),/completely decoded/);
  await assert.rejects(analyzeAudio(a,{...options,duration:60}),/duration differs/);
  const controller=new AbortController();controller.abort();await assert.rejects(analyzeAudio(a,{...options,signal:controller.signal}),/abort/i);
});

test('real Essentia labels silence without inventing BPM/key and worker cancellation/timeout terminates work',{skip:!runtime.available||!hasFFmpeg,timeout:15000},async t=>{
  const dir=await temp(t),path=join(dir,'silence.wav');await run(ffmpeg,['-v','error','-f','lavfi','-i','anullsrc=r=44100:cl=mono','-t','3',path]);
  const result=await analyzeAudio(path,{ffmpeg,backend:'essentia',duration:3});assert.equal(result.energy,1);assert.equal(result.audioFeatures.rhythm,null);assert.equal(result.audioFeatures.tonal,null);
  const excerpts=()=>({intro:new Float32Array(44100*12),body:new Float32Array(44100*12),outro:new Float32Array(44100*12)});
  const controller=new AbortController(),pending=runEssentiaWorker(excerpts(),{directory:essentiaDirectory(),signal:controller.signal});setTimeout(()=>controller.abort(),10);await assert.rejects(pending,/Cancelled/);
  await assert.rejects(runEssentiaWorker(excerpts(),{directory:essentiaDirectory(),timeout:1}),/timed out/);
});

test('Essentia worker is independent of parent module-mode command-line flags',{skip:!runtime.available},async()=>{
  const module=new URL('../src/essentia-analysis.mjs',import.meta.url).href;
  const code=`const {runEssentiaWorker}=await import(${JSON.stringify(module)});const x=()=>new Float32Array(44100);const r=await runEssentiaWorker({intro:x(),body:x(),outro:x()},{directory:${JSON.stringify(essentiaDirectory())}});console.log(r.audioFeatures.backend);`;
  const output=await run(process.execPath,['--input-type=module','-e',code],{timeout:15000});assert.match(output,/essentia/);
});
