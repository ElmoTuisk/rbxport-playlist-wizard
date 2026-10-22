import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';

export const ANALYZER_VERSION = 'wizard-intensity-1';
export function fileStamp(info) { return {size:info.size,mtimeMs:info.mtimeMs,dev:info.dev,ino:info.ino}; }
export const sameStamp = (a,b) => JSON.stringify(a)===JSON.stringify(b);
const clamp = x => Math.max(0,Math.min(1,x));
const quantile = (values,fraction) => {const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.floor(fraction*(sorted.length-1)))] || 0;};
// Constant-memory PCM frame processing; all amplitudes are compared as ratios.
// These are explainable experimental features, not a trained energy classifier.
export class IntensityFrames {
  constructor() {this.frames=[];this.count=0;this.sum=0;this.diff=0;this.peak=0;this.previous=0;this.low=0;this.bass=0;}
  push(samples) {
    for(const sample of samples) {
      if(!Number.isFinite(sample))throw Error('Invalid decoded audio');
      this.low+=0.12*(sample-this.low);
      this.sum+=sample*sample;this.bass+=this.low*this.low;this.diff+=(sample-this.previous)**2;
      this.peak=Math.max(this.peak,Math.abs(sample));this.previous=sample;this.count++;
      if(this.count===1000)this.flush();
    }
  }
  flush() {
    if(!this.count)return;
    this.frames.push({rms:Math.sqrt(this.sum/this.count),brightness:Math.sqrt(this.diff/Math.max(1e-20,this.sum))/2,
      bass:this.bass/Math.max(1e-20,this.sum),crest:this.peak/Math.max(1e-10,Math.sqrt(this.sum/this.count))});
    this.count=0;this.sum=0;this.diff=0;this.bass=0;this.peak=0;
  }
  finish() {
    this.flush();
    if(this.frames.length<4)throw Error('Not enough audio to analyze');
    const loud=quantile(this.frames.map(f=>f.rms),0.9);
    if(loud<1e-7)return {energy:1,intro:1,outro:1,peak:1,raw:{activity:0,brightness:0,bass:0,dynamics:0},evidence:'silent'};
    const summarize=frames=>{
      const active=frames.filter(f=>f.rms>loud*0.03);
      if(!active.length)return {energy:1,raw:{activity:0,brightness:0,bass:0,dynamics:0}};
      let onsets=0;for(let i=1;i<frames.length;i++)if(frames[i].rms>frames[i-1].rms*1.5&&frames[i].rms>loud*0.15)onsets++;
      const activity=clamp(onsets/Math.max(1,frames.length/8)/4);
      const brightness=clamp(quantile(active.map(f=>f.brightness),0.6)*2);
      const bass=clamp(quantile(active.map(f=>f.bass),0.6));
      const dynamics=clamp(1-quantile(active.map(f=>f.crest),0.5)/8);
      const sustained=active.length/frames.length;
      return {energy:Math.round((1+9*clamp(activity*0.45+brightness*0.25+bass*0.1+dynamics*0.1+sustained*0.1))*10)/10,
        raw:{activity,brightness,bass,dynamics}};
    };
    const trim=Math.floor(this.frames.length*0.15),body=this.frames.slice(trim,Math.max(trim+1,this.frames.length-trim));
    const summary=summarize(body),region=Math.min(256,Math.max(4,trim));
    return {...summary,intro:summarize(this.frames.slice(0,region)).energy,outro:summarize(this.frames.slice(-region)).energy,
      peak:Math.max(summary.energy,summarize(this.frames.filter(f=>f.rms>=loud*0.7)).energy),evidence:'experimental-audio-estimate'};
  }
}
export async function analyzeAudio(path,options={}) {
  if(options.backend==='essentia')return (await import('./essentia-analysis.mjs')).analyzeEssentiaAudio(path,options);
  if(options.backend&&options.backend!=='basic')throw Error('Choose a supported audio analysis backend');
  return analyzeBasicAudio(path,options);
}
export async function analyzeBasicAudio(path,{ffmpeg='ffmpeg',signal}={}) {
  if(!isAbsolute(path)||!/(?:\.mp3|\.wav|\.wave|\.aiff?|\.flac|\.m4a|\.aac|\.ogg|\.opus)$/i.test(path))throw Error('Choose a supported host-resolved local audio file');
  const before=fileStamp(await stat(path)),frames=new IntensityFrames();
  await new Promise((resolve,reject)=>{
    signal?.throwIfAborted();
    const child=spawn(ffmpeg,['-nostdin','-v','error','-xerror','-protocol_whitelist','file,pipe','-i',path,'-map','0:a:0','-vn','-ac','1','-ar','8000','-f','f32le','pipe:1'],{shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let pending=Buffer.alloc(0),bytes=0,failure=null,settled=false;
    const abort=()=>{failure=Error('Cancelled');child.kill();};
    const timer=setTimeout(()=>{failure=Error('Audio analysis timed out');child.kill();},180000);
    signal?.addEventListener('abort',abort,{once:true});
    const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve();};
    child.on('error',()=>finish(Error('Cannot start the configured FFmpeg for local analysis')));
    child.stderr.on('data',()=>{}); // Raw decoder diagnostics may contain private paths.
    child.stdout.on('data',chunk=>{
      if(failure)return;
      try {
        bytes+=chunk.length;if(bytes>8000*4*1800)throw Error('Analysis is limited to 30 minutes per track');
        const data=pending.length?Buffer.concat([pending,chunk]):chunk;
        const end=data.length-data.length%4,values=new Float32Array(end/4);
        for(let i=0;i<values.length;i++)values[i]=data.readFloatLE(i*4);
        pending=Buffer.from(data.subarray(end));frames.push(values);
      }catch(error){failure=error;child.kill();}
    });
    child.on('close',code=>finish(failure||(code===0&&!pending.length?null:Error('Audio could not be completely decoded'))));
  });
  signal?.throwIfAborted();
  if(!sameStamp(before,fileStamp(await stat(path))))throw Error('Audio changed during analysis');
  return {...frames.finish(),version:ANALYZER_VERSION,stamp:before};
}
export function cacheKey(namespace,id) {return createHash('sha256').update(JSON.stringify([namespace,id])).digest('hex');}
