import { createHash, randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { generate, prepareDurations } from './optimizer.mjs';
import { recipeFrom } from './recipe.mjs';
import { analyzeAudio, ANALYZER_VERSION, cacheKey, fileStamp, sameStamp } from './analysis.mjs';
import { ESSENTIA_ANALYZER_VERSION,verifyEssentia } from './essentia-runtime.mjs';
import {applyAnalysis} from './track-features.mjs';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sequenceEqual=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export class Wizard {
  constructor(store,bridge,{changed=()=>{},ffmpeg='ffmpeg',fileStat=stat,analyzer=analyzeAudio}={}) {
    Object.assign(this,{store,bridge,changed,ffmpeg,fileStat,analyzer});this.sources=new Map();this.active=null;this.task=null;
    this.optionsModel={sources:[]};this.message='Choose music, a length and an energy curve.';
    this.draft=store.get('wizard','draft');
    for(const write of store.all('wizard-writes'))if(['creating','adding'].includes(write.status))store.put('wizard-writes',write.id,{...write,status:write.targetId?'interrupted':'uncertain'});
  }
  publicState() {
    const draft=this.draft;
    const write=draft?.writeId?this.store.get('wizard-writes',draft.writeId):null;
    return {active:this.active,message:this.message,options:this.optionsModel,progress:this.progress,error:this.error||'',
      draft:draft?{id:draft.id,sourceName:draft.sourceName,source:{id:draft.source.id,playlistIds:draft.source.playlistIds},recipe:draft.recipe,coverage:draft.coverage,warnings:draft.warnings,
        fullSeconds:draft.fullSeconds,mixedSeconds:draft.mixedSeconds,search:draft.search,exclusions:draft.exclusions,
        tracks:draft.tracks.map(({id,title,artist,duration,bpm,key,bpmEvidence,keyEvidence,energy,energyEvidence,audioFeatures,featureWarnings,start,targetEnergy,transition})=>({id,title,artist,duration,bpm,key,bpmEvidence,keyEvidence,energy,energyEvidence,audioFeatures,featureWarnings,start,targetEnergy,transition})),
        write:write?{status:write.status,targetId:write.targetId,name:write.name,message:write.message}:null}:null};
  }
  async options() {
    const info=await this.bridge.call('info');
    if(!info.libraryId||!Array.isArray(info.playlists))throw Error('Cannot establish current library identity');
    const sources=new Map([['playlists',{id:'playlists',kind:'playlists',libraryId:info.libraryId,name:'Selected playlists',playlists:info.playlists}],
      ['collection',{id:'collection',kind:'collection',libraryId:info.libraryId,name:'Entire collection',playlists:[]}]]);
    let usbError='';
    try {
      const devices=await this.bridge.call('devices',{libraryId:info.libraryId});
      for(const device of devices)for(const library of device.libraries||[]) {
        if(!device.volumeId||!device.path||!['deviceLibrary','oneLibrary'].includes(library.format))continue;
        const id='usb-'+digest([device.volumeId,library.format]);
        sources.set(id,{id,kind:'device',libraryId:info.libraryId,name:`${device.name||'USB'} · ${library.format==='oneLibrary'?'OneLibrary':'Device Library'}`,
          device:{volumeId:device.volumeId,path:device.path,format:library.format},playlists:(library.nodes||[]).filter(p=>!p.folder).map(p=>({id:p.id,name:p.name}))});
      }
    }catch{usbError='USB browsing is unavailable in this host connection. Desktop playlists remain available.';}
    this.sources=sources;
    this.optionsModel={sources:[...sources.values()].map(({id,name,playlists})=>({id,name,playlists})),usbError};this.changed();return this.optionsModel;
  }
  async resolveSource(value) {
    await this.options();
    const source=this.sources.get(value?.id);
    if(!source)throw Error('Choose an available source');
    const playlistIds=value.playlistIds??[];
    if(!Array.isArray(playlistIds)||playlistIds.length>100||playlistIds.some(id=>typeof id!=='string'||!source.playlists.some(p=>p.id===id))||new Set(playlistIds).size!==playlistIds.length)throw Error('Choose valid source playlists');
    if(source.kind==='playlists'&&!playlistIds.length)throw Error('Choose at least one playlist');
    if(source.kind==='collection'&&playlistIds.length)throw Error('Collection source does not take playlists');
    return {...source,playlistIds};
  }
  async readPool(source,signal) {
    const unique=new Map();
    for(const playlistId of source.playlistIds.length?source.playlistIds:[null]) {
      signal?.throwIfAborted();
      const args={libraryId:source.libraryId,device:source.device,playlistId};
      const view=await this.bridge.call('open',args);
      if(view.libraryId!==source.libraryId||!Number.isInteger(view.len)||view.len<0||view.len>10000)throw Error('Source is unavailable or exceeds the 10,000-track preview limit');
      const within=new Set();
      for(let offset=0;offset<view.len;offset+=64) {
        signal?.throwIfAborted();
        const count=Math.min(64,view.len-offset),rows=await this.bridge.call('page',{...args,viewId:view.viewId,offset,count});
        if(!Array.isArray(rows)||rows.length!==count)throw Error('Source changed during scanning; generate again');
        await Promise.all(rows.map(async track=>{
          if(typeof track.id!=='string'||!track.id||within.has(track.id))throw Error('Source has repeated memberships; review them before autosorting');
          within.add(track.id);let stamp=null;
          if(track.path)try{const info=await this.fileStat(track.path);if(info.isFile())stamp=fileStamp(info);}catch{}
          const normalized={...track,bpm:Number.isFinite(track.bpm)&&track.bpm>0?track.bpm:null,duration:Number(track.duration),missing:Boolean(track.missing||!stamp),stamp};
          const prior=unique.get(track.id);
          if(prior&&digest(prior)!==digest(normalized))throw Error('Conflicting track metadata across source playlists; refresh and retry');
          unique.set(track.id,normalized);
        }));
        if(unique.size>10000)throw Error('Choose at most 10,000 distinct tracks');
        this.progress={stage:'Reading source',completed:offset+count,total:view.len};this.changed();
      }
      const after=await this.bridge.call('open',args);
      if(after.libraryId!==view.libraryId||after.len!==view.len||(view.gen!==undefined&&after.gen!==view.gen))throw Error('Source changed during scanning; generate again');
    }
    // Map insertion order after concurrent stat work is not source order. Sort by ID
    // for stable snapshots; the optimizer deliberately proposes a new order.
    const tracks=[...unique.values()].sort((a,b)=>a.id.localeCompare(b.id));
    return {tracks,signature:digest(tracks)};
  }
  start(kind,args={}) {
    if(this.active)throw Error('Wait for Playlist Wizard or cancel the current operation');
    if(!['generate','create'].includes(kind))throw Error('Unsupported operation');
    // Validate user settings before replacing the current preview.
    if(kind==='generate')recipeFrom(args.recipe);
    this.active=kind;this.controller=new AbortController();this.error='';this.progress=null;this.message=kind==='generate'?'Preparing a draft…':'Creating playlist…';this.changed();
    this.task=(async()=>{
      try {if(kind==='generate')await this.generate(args,this.controller.signal);else await this.create(args,this.controller.signal);}
      catch(error){this.error=this.controller.signal.aborted?'Cancelled. Completed analysis is cached; a partial playlist, if any, is retained.':error.message;this.message=this.error;}
      finally{this.active=null;this.controller=null;this.progress=null;this.changed();}
    })();
    return {started:true};
  }
  async generate(args,signal) {
    const recipe=recipeFrom(args.recipe);
    if(recipe.analyze&&recipe.analysisBackend==='essentia'&&this.analyzer===analyzeAudio)await verifyEssentia();
    const source=await this.resolveSource(args.source),snapshot=await this.readPool(source,signal);
    const present=snapshot.tracks.filter(t=>!t.missing);
    if(recipe.mode==='all'&&present.length!==snapshot.tracks.length)throw Error('Autosort keeps every song. Restore missing files before generating this source.');
    const {tracks:available,exclusions,warnings}=prepareDurations(present,recipe);
    if(recipe.mode==='songs'&&recipe.songs>available.length)throw Error(`Only ${available.length} distinct songs are available. ${warnings.join(' ')}`.trim());
    const namespace=JSON.stringify([source.libraryId,source.device||null]);
    const analyzerVersion=recipe.analysisBackend==='essentia'?ESSENTIA_ANALYZER_VERSION:ANALYZER_VERSION;
    const tracks=[];
    for(const [index,track] of available.entries()) {
      signal.throwIfAborted();
      const key=cacheKey(namespace,track.id),analysisKey=cacheKey(namespace+':'+analyzerVersion,track.id);
      const cached=this.store.get('wizard-analysis',analysisKey)||(recipe.analysisBackend==='basic'?this.store.get('wizard-analysis',key):null);
      let analysis=cached?.version===analyzerVersion&&sameStamp(cached.stamp,track.stamp)?cached:null;
      if(analysis?.audioFeatures?.decodedSeconds&&Math.abs(analysis.audioFeatures.decodedSeconds-track.duration)>Math.max(3,track.duration*0.02))throw Error('Host duration differs from cached decoded audio; refresh the track before generating.');
      if(recipe.analyze&&!analysis) {
        this.progress={stage:recipe.analysisBackend==='essentia'?'Analyzing with Essentia':'Analyzing with Basic',completed:index,total:available.length};this.changed();
        await this.bridge.call('identity',{libraryId:source.libraryId,device:source.device});signal.throwIfAborted();
        let analysisFailure;
        try {analysis=await this.analyzer(track.path,{ffmpeg:this.ffmpeg,signal,backend:recipe.analysisBackend,duration:track.duration});}
        catch(error){signal.throwIfAborted();analysisFailure=error;track.analysisError=error.message;}
        await this.bridge.call('identity',{libraryId:source.libraryId,device:source.device});signal.throwIfAborted();
        if(analysisFailure?.code==='WIZARD_DURATION_CHANGED')throw analysisFailure;
        if(analysis){if(analysis.version!==analyzerVersion)throw Error('Analysis backend/version changed; generate again');if(!sameStamp(analysis.stamp,track.stamp))throw Error('Music changed while awaiting analysis; generate again');this.store.put('wizard-analysis',analysisKey,analysis);}
      }
      let override=args.overrides?.[track.id];
      if(override===null){this.store.delete('wizard-overrides',key);override=undefined;}
      else if(override!==undefined){
        if(typeof override!=='number'||!Number.isFinite(override)||override<1||override>10)throw Error('Energy overrides must be from 1 to 10');
        this.store.put('wizard-overrides',key,{energy:override,stamp:track.stamp});
      }else{const saved=this.store.get('wizard-overrides',key);if(saved&&sameStamp(saved.stamp,track.stamp))override=saved.energy;}
      tracks.push(applyAnalysis(track,analysis,override));
    }
    const result=await generate(tracks,recipe,{signal,onProgress:value=>{this.progress=value;this.changed();}});
    result.exclusions={...exclusions,missing:snapshot.tracks.length-present.length};result.warnings.push(...warnings);
    if(present.length<snapshot.tracks.length)result.warnings.push(`${snapshot.tracks.length-present.length} unavailable files excluded from selection.`);
    const failures=tracks.filter(t=>t.analysisError).length;if(failures)result.warnings.push(`${failures} tracks could not complete audio analysis; missing features remain unknown.`);
    const featureReviews=tracks.filter(t=>t.featureWarnings.length).length;if(featureReviews)result.warnings.push(`${featureReviews} tracks have unavailable descriptors or host/estimate disagreements; review their song notes.`);
    if(tracks.some(t=>t.audioFeatures?.backend==='essentia'))result.warnings.push('Essentia descriptors cover up to 30 seconds each from intro, middle and outro after complete file decoding. Beat/key strength is not a probability. Energy scoring remains experimental; phrase/vocal compatibility is not analyzed.');
    this.draft={...result,id:randomUUID(),source,sourceName:source.name,signature:snapshot.signature,created:Date.now()};
    this.store.put('wizard','draft',this.draft);this.message=`Draft ready: ${result.tracks.length} songs. Review before creating a playlist.`;
  }
  async create(args,signal) {
    const draft=this.draft;
    if(!draft||args.id!==draft.id)throw Error('Generate and review the current draft first');
    const name=String(args.name||'').trim();if(!name||name.length>160||/[\u0000-\u001f]/.test(name))throw Error('Choose a playlist name of 1–160 characters');
    const existing=draft.writeId&&this.store.get('wizard-writes',draft.writeId);
    if(existing?.status==='verified'){this.message='This draft was already created and verified.';return;}
    if(existing?.status==='uncertain')throw Error('Creation outcome is uncertain. Inspect rbxport before generating another copy; automatic recreation is blocked.');
    const snapshot=await this.readPool(draft.source,signal);
    if(snapshot.signature!==draft.signature)throw Error('Source music or metadata changed. Generate and review a fresh draft.');
    let journal=existing||{id:randomUUID(),draftId:draft.id,name,source:draft.source,ids:draft.tracks.map(t=>t.id),status:'creating',targetId:null};
    if(existing&&name!==existing.name)throw Error('Resume with the original playlist name');
    draft.writeId=journal.id;this.store.put('wizard','draft',draft);this.store.put('wizard-writes',journal.id,journal);
    const save=(status,message='')=>{journal={...journal,status,message};this.store.put('wizard-writes',journal.id,journal);this.changed();};
    try {
      signal.throwIfAborted();
      if(!journal.targetId) {
        journal.targetId=await this.bridge.call('create',{libraryId:draft.source.libraryId,device:draft.source.device,name});
        if(typeof journal.targetId!=='string'||!journal.targetId)throw Error('Cannot establish created playlist identity');
        save('adding');
      }
      const readTarget=async()=>{
        const view=await this.bridge.call('open',{libraryId:draft.source.libraryId,device:draft.source.device,playlistId:journal.targetId});
        if(view.libraryId!==draft.source.libraryId||!Number.isInteger(view.len)||view.len<0||view.len>journal.ids.length)throw Error('Created playlist changed; automatic resume refused');
        const ids=[];for(let offset=0;offset<view.len;offset+=64){const count=Math.min(64,view.len-offset),rows=await this.bridge.call('page',{libraryId:draft.source.libraryId,device:draft.source.device,viewId:view.viewId,offset,count});if(rows.length!==count)throw Error('Created playlist changed during verification');ids.push(...rows.map(t=>t.id));}return ids;
      };
      let present=await readTarget();
      if(!sequenceEqual(present,journal.ids.slice(0,present.length)))throw Error('Created playlist contains unexpected songs or order; inspect it before resuming');
      for(let offset=present.length;offset<journal.ids.length;offset+=64) {
        signal.throwIfAborted();
        const ids=journal.ids.slice(offset,offset+64);save('adding');
        await this.bridge.call('add',{libraryId:draft.source.libraryId,device:draft.source.device,playlistId:journal.targetId,ids});
        present=await readTarget();if(!sequenceEqual(present,journal.ids.slice(0,offset+ids.length)))throw Error('Host did not preserve the generated order; partial playlist retained');
        this.progress={stage:'Verifying playlist',completed:present.length,total:journal.ids.length};this.changed();
      }
      signal.throwIfAborted();
      if(!sequenceEqual(await readTarget(),journal.ids))throw Error('Final playlist membership/order verification failed');
      save('verified','Exact membership and order verified');this.message=`Created “${journal.name}”: ${journal.ids.length} songs; order verified.`;
    } catch(error) {save(journal.targetId?'interrupted':'uncertain',error.message);throw error;}
  }
  cancel(){this.controller?.abort();}
  async close(){this.cancel();await this.task;}
}
