import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,readFile,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { IntensityFrames,analyzeAudio,ANALYZER_VERSION } from '../src/analysis.mjs';
import { run } from '../src/process.mjs';
const sample=(gain=1,pulse=false)=>{
  const values=new Float32Array(8000*8);
  for(let i=0;i<values.length;i++)values[i]=gain*Math.sin(2*Math.PI*220*i/8000)*(pulse?(i%2000<700?1:0.02):1);
  const frames=new IntensityFrames();frames.push(values);return frames.finish();
};
test('intensity processing is gain invariant, responsive to rhythmic activity and labels silence',()=>{
  const a=sample(0.1,true),b=sample(0.8,true),steady=sample(0.8,false);
  assert.equal(a.energy,b.energy);assert(a.raw.activity>steady.raw.activity);
  assert(a.energy>steady.energy);assert.equal(a.evidence,'experimental-audio-estimate');
  const silence=new IntensityFrames();silence.push(new Float32Array(8000));assert.equal(silence.finish().energy,1);
  assert.throws(()=>{const f=new IntensityFrames();f.push([NaN]);},/Invalid decoded/);
});
const ffmpeg=process.env.FFMPEG||'ffmpeg';
const available=spawnSync(ffmpeg,['-version'],{windowsHide:true}).status===0;
test('real FFmpeg completely decodes synthetic audio, preserves source bytes and rejects damaged files',{skip:!available},async t=>{
  const dir=await mkdtemp(join(tmpdir(),'playlist-wizard-audio-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const path=join(dir,'fixture.wav');
  await run(ffmpeg,['-v','error','-f','lavfi','-i','sine=frequency=220:duration=3','-ac','2',path]);
  const before=await readFile(path),result=await analyzeAudio(path,{ffmpeg});
  assert.equal(result.version,ANALYZER_VERSION);assert(result.energy>=1&&result.energy<=10);assert.deepEqual(await readFile(path),before);
  await assert.rejects(analyzeAudio('https://example.com/music.mp3',{ffmpeg}),/local audio/);
  const controller=new AbortController();controller.abort();await assert.rejects(analyzeAudio(path,{ffmpeg,signal:controller.signal}),/abort/i);
  const damaged=join(dir,'damaged.mp3');await writeFile(damaged,'not an audio file');await assert.rejects(analyzeAudio(damaged,{ffmpeg}),/completely decoded/);
});
