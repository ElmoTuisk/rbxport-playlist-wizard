import {spawn} from 'node:child_process';
import {Worker} from 'node:worker_threads';
import {stat} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {fileStamp,sameStamp} from './analysis.mjs';
import {verifyEssentia,ESSENTIA_ANALYZER_VERSION} from './essentia-runtime.mjs';
export class ExcerptCollector {
  constructor(duration,sampleRate=44100) {
    if(!Number.isFinite(duration)||duration<=0||duration>1800)throw Error('Essentia needs a known track duration of at most 30 minutes');
    this.sampleRate=sampleRate;this.expectedDuration=duration;this.count=0;
    const length=Math.ceil(Math.min(30,duration)*sampleRate),bodyStart=Math.max(0,Math.floor((duration-30)/2*sampleRate)),tailStart=Math.max(0,Math.floor((duration-30)*sampleRate));
    this.windows={intro:{start:0,data:new Float32Array(length),filled:0},body:{start:bodyStart,data:new Float32Array(length),filled:0},outro:{start:tailStart,data:new Float32Array(length),filled:0}};
  }
  push(values) {
    for(const value of values)if(!Number.isFinite(value))throw Error('Invalid decoded audio');
    const end=this.count+values.length;
    if(end>this.sampleRate*1800)throw Object.assign(Error('Decoded audio exceeds the 30-minute track limit; refresh the host duration'),{code:'WIZARD_DURATION_CHANGED'});
    for(const window of Object.values(this.windows)) {
      const from=Math.max(this.count,window.start),to=Math.min(end,window.start+window.data.length);
      if(to>from){window.data.set(values.subarray(from-this.count,to-this.count),from-window.start);window.filled+=to-from;}
    }
    this.count=end;
  }
  finish() {
    const duration=this.count/this.sampleRate;
    if(duration<1||Math.abs(duration-this.expectedDuration)>Math.max(3,this.expectedDuration*0.02))throw Object.assign(Error('Decoded duration differs from library metadata; refresh the track before analysis'),{code:'WIZARD_DURATION_CHANGED'});
    const excerpts={};for(const [name,window] of Object.entries(this.windows)){if(window.filled<this.sampleRate)throw Error('Not enough audio for the requested excerpt');excerpts[name]=window.data.slice(0,window.filled);}
    return {duration,excerpts,coverage:Object.fromEntries(Object.entries(this.windows).map(([name,w])=>[name,{start:w.start/this.sampleRate,seconds:w.filled/this.sampleRate}]))};
  }
}
async function decodeExcerpts(path,{duration,ffmpeg,signal}) {
  const collector=new ExcerptCollector(duration);
  await new Promise((resolve,reject)=>{
    signal?.throwIfAborted();const child=spawn(ffmpeg,['-nostdin','-v','error','-xerror','-protocol_whitelist','file,pipe','-i',path,'-map','0:a:0','-vn','-ac','1','-ar','44100','-f','f32le','pipe:1'],{shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let pending=Buffer.alloc(0),failure=null,done=false;
    const abort=()=>{failure=Error('Cancelled');child.kill();};
    const timer=setTimeout(()=>{failure=Error('Audio analysis timed out');child.kill();},180000);signal?.addEventListener('abort',abort,{once:true});
    const finish=error=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve();};
    child.on('error',()=>finish(Error('Cannot start the configured FFmpeg for local analysis')));child.stderr.on('data',()=>{});
    child.stdout.on('data',chunk=>{if(failure)return;try{const data=pending.length?Buffer.concat([pending,chunk]):chunk,end=data.length-data.length%4,values=new Float32Array(end/4);for(let i=0;i<values.length;i++)values[i]=data.readFloatLE(i*4);pending=Buffer.from(data.subarray(end));collector.push(values);}catch(error){failure=error;child.kill();}});
    child.on('close',code=>finish(failure||(code===0&&!pending.length?null:Error('Audio could not be completely decoded'))));
  });
  return collector.finish();
}
export function runEssentiaWorker(excerpts,{directory,signal,timeout=90000,estimateBpm=true,estimateKey=true}={}) {
  return new Promise((resolve,reject)=>{
    signal?.throwIfAborted();const worker=new Worker(new URL('./essentia-worker.mjs',import.meta.url),{workerData:{directory,excerpts,options:{estimateBpm,estimateKey}},transferList:[...new Set(Object.values(excerpts).map(a=>a.buffer))],execArgv:[],stdout:true,stderr:true,resourceLimits:{maxOldGenerationSizeMb:256}});
    let done=false;const finish=(error,result)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);const settled=()=>{error?reject(error):resolve(result);};void worker.terminate().then(settled,settled);};
    const abort=()=>finish(Error('Cancelled'));
    const timer=setTimeout(()=>finish(Error('Essentia analysis timed out')),timeout);signal?.addEventListener('abort',abort,{once:true});
    worker.stdout.on('data',()=>{});worker.stderr.on('data',()=>{});
    worker.once('message',message=>finish(message.error?Error(message.error):null,message.result));
    worker.once('error',()=>finish(Error('Essentia analysis worker failed')));worker.once('exit',()=>{if(!done)finish(Error('Essentia analysis worker stopped without a result'));});
  });
}
export async function analyzeEssentiaAudio(path,{ffmpeg='ffmpeg',duration,signal,directory,estimateBpm=true,estimateKey=true}={}) {
  if(!isAbsolute(path)||!/(?:\.mp3|\.wav|\.wave|\.aiff?|\.flac|\.m4a|\.aac|\.ogg|\.opus)$/i.test(path))throw Error('Choose a supported host-resolved local audio file');
  const runtime=await verifyEssentia(directory),before=fileStamp(await stat(path));
  const decoded=await decodeExcerpts(path,{duration,ffmpeg,signal});signal?.throwIfAborted();
  const result=await runEssentiaWorker(decoded.excerpts,{directory:runtime.directory,signal,estimateBpm,estimateKey});signal?.throwIfAborted();
  if(!sameStamp(before,fileStamp(await stat(path))))throw Error('Audio changed during analysis');
  return {...result,version:ESSENTIA_ANALYZER_VERSION,stamp:before,audioFeatures:{...result.audioFeatures,decodedSeconds:decoded.duration,sampled:decoded.coverage}};
}
