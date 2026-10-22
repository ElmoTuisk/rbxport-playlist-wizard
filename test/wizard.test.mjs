import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { Wizard } from '../src/wizard.mjs';
import { ESSENTIA_ANALYZER_VERSION as ANALYZER_VERSION } from '../src/essentia-runtime.mjs';
import {ANALYZER_VERSION as BASIC_VERSION} from '../src/analysis.mjs';
function fixture(count=8) {
  const store=new Store(':memory:'),calls=[];
  let libraryId='fixture',volumeId='usb',failAdd=false,uncertainCreate=false,scramble=false;
  const playlists=new Map([['source',Array.from({length:count},(_,i)=>String(i))]]),tracks=new Map(Array.from({length:count},(_,i)=>[String(i),{id:String(i),title:'Track '+i,artist:'Artist '+i,path:'/fixture/'+i+'.mp3',duration:300,bpm:128,key:'8A'}]));
  const bridge={async call(method,args={}){
    calls.push({method,args});
    if(args.libraryId&&args.libraryId!==libraryId)throw Error('Wrong library');
    if(args.device&&args.device.volumeId!==volumeId)throw Error('USB identity changed');
    if(method==='identity')return {libraryId};
    if(method==='info')return {libraryId,playlists:[{id:'source',name:'Selected crate'}]};
    if(method==='devices')return [{volumeId,path:'/fixture-usb',name:'Fixture USB',libraries:[{format:'oneLibrary',nodes:[{id:'source',name:'USB crate',folder:false}]}]}];
    if(method==='open'){const ids=args.playlistId?playlists.get(args.playlistId):[...tracks.keys()];if(!ids)throw Error('Playlist missing');return {libraryId,viewId:args.playlistId||'all',len:ids.length,gen:1};}
    if(method==='page'){const ids=args.viewId==='all'?[...tracks.keys()]:playlists.get(args.viewId);return ids.slice(args.offset,args.offset+args.count).map(id=>({...tracks.get(id)}));}
    if(method==='create'){if(uncertainCreate)throw Error('Creation timed out');playlists.set('created',[]);return 'created';}
    if(method==='add'){const target=playlists.get(args.playlistId);target.push(...args.ids.filter(id=>!target.includes(id)));if(scramble)target.reverse();if(failAdd){failAdd=false;throw Error('Add response lost after native completion');}return;}
    throw Error('Unexpected operation: '+method);
  }};
  const stamp={size:123,mtimeMs:1,dev:1,ino:1};
  const options={fileStat:async()=>({...stamp,isFile:()=>true}),analyzer:async()=>({...{energy:5,evidence:'experimental-audio-estimate'},version:ANALYZER_VERSION,stamp:{...stamp}})};
  const wizard=new Wizard(store,bridge,options);
  return {store,bridge,wizard,options,playlists,tracks,calls,stamp,setLibrary:v=>libraryId=v,setVolume:v=>volumeId=v,loseAdd:()=>failAdd=true,loseCreate:()=>uncertainCreate=true,scramble:()=>scramble=true};
}
async function draft(f,extra={}){f.wizard.start('generate',{source:{id:'playlists',playlistIds:['source']},recipe:{mode:'all',...extra}});await f.wizard.task;assert.equal(f.wizard.error,'');return f.wizard.draft;}

test('analysis caches are isolated by backend/version while manual corrections remain reusable',async t=>{
  const f=fixture();t.after(()=>f.store.close());const calls=[];
  f.wizard.analyzer=async(path,options)=>{calls.push(options.backend);return {...await f.options.analyzer(),version:options.backend==='basic'?BASIC_VERSION:ANALYZER_VERSION};};
  f.wizard.start('generate',{source:{id:'playlists',playlistIds:['source']},recipe:{mode:'all',analyze:true,analysisBackend:'basic'},overrides:{0:9}});await f.wizard.task;assert.equal(f.wizard.error,'');
  await draft(f,{analyze:true,analysisBackend:'essentia'});await draft(f,{analyze:true,analysisBackend:'essentia'});await draft(f,{analyze:true,analysisBackend:'basic'});
  assert.equal(calls.filter(x=>x==='essentia').length,8);assert.equal(calls.filter(x=>x==='basic').length,8);
  assert.equal(f.wizard.draft.tracks.find(t=>t.id==='0').energy,9);
  f.stamp.mtimeMs=2;await draft(f,{analyze:true});assert.equal(calls.filter(x=>x==='essentia').length,16);
});

test('Essentia fills only missing BPM/key, keeps host values and exposes evidence without rewriting source metadata',async t=>{
  const f=fixture();t.after(()=>f.store.close());f.tracks.get('0').bpm=null;f.tracks.get('0').key='';
  f.wizard.analyzer=async()=>({...await f.options.analyzer(),audioFeatures:{backend:'essentia',rhythm:{bpm:128,confidence:3,regularity:0.95},tonal:{key:'Am',strength:0.8},sections:{}}});
  const d=await draft(f,{analyze:true,strictKey:true});const estimated=d.tracks.find(t=>t.id==='0'),existing=d.tracks.find(t=>t.id==='1');
  assert.equal(estimated.bpm,128);assert.equal(estimated.key,'Am');assert.equal(estimated.bpmEvidence,'Essentia excerpt estimate');assert.equal(existing.key,'8A');assert.equal(existing.keyEvidence,'host metadata');
  assert.equal(f.tracks.get('0').bpm,null);assert.equal(f.tracks.get('0').key,'');assert(!f.calls.some(c=>['create','add','analyse','update'].includes(c.method)));
  assert.equal(f.wizard.publicState().draft.tracks.find(t=>t.id==='0').audioFeatures.rhythm.confidence,3);
});

test('measured duration mismatches refuse generation and changed host durations cannot reuse cached audio silently',async t=>{
  const f=fixture();t.after(()=>f.store.close());
  f.wizard.analyzer=async()=>{throw Object.assign(Error('Decoded duration differs from library metadata'),{code:'WIZARD_DURATION_CHANGED'});};
  f.wizard.start('generate',{source:{id:'playlists',playlistIds:['source']},recipe:{mode:'songs',songs:2,analyze:true}});await f.wizard.task;
  assert.match(f.wizard.error,/Decoded duration differs/);assert.equal(f.wizard.draft,null);
  f.wizard.analyzer=async()=>({...await f.options.analyzer(),audioFeatures:{backend:'essentia',decodedSeconds:300}});await draft(f,{analyze:true});
  f.tracks.get('0').duration=600;f.wizard.start('generate',{source:{id:'playlists',playlistIds:['source']},recipe:{mode:'songs',songs:2,analyze:false}});await f.wizard.task;
  assert.match(f.wizard.error,/Host duration differs from cached/);assert(!f.calls.some(c=>['create','add'].includes(c.method)));
});

test('two long recordings in a 1026-track source cannot block a smaller set or enter audio analysis',async t=>{
  const f=fixture(1026);t.after(()=>f.store.close());f.tracks.get('0').duration=7338;f.tracks.get('1').duration=6989;
  let analyses=0;f.wizard.analyzer=async()=>{analyses++;return f.options.analyzer();};
  const d=await draft(f,{mode:'songs',songs:20,analyze:true});
  assert.equal(d.tracks.length,20);assert.equal(analyses,1024);
  assert.deepEqual(d.exclusions,{unknownDuration:0,tooLong:2,missing:0});assert(d.warnings.some(w=>w.includes('2 tracks longer than 30 minutes')));
  assert(!d.tracks.some(t=>['0','1'].includes(t.id)));assert.equal(f.playlists.get('source').length,1026);
  assert.equal(f.wizard.publicState().draft.exclusions.tooLong,2);assert(!f.calls.some(c=>['create','add'].includes(c.method)));
});

test('duration exclusions are explicit, preserve autosort and locks, and fail before expensive analysis',async t=>{
  const f=fixture();t.after(()=>f.store.close());f.tracks.get('0').duration=7000;f.tracks.get('1').duration=0;
  let analyses=0;f.wizard.analyzer=async()=>{analyses++;return f.options.analyzer();};
  f.wizard.start('generate',{source:{id:'playlists',playlistIds:['source']},recipe:{mode:'all',analyze:true}});await f.wizard.task;
  assert.match(f.wizard.error,/Autosort keeps every song.*longer than 30 minutes.*missing or invalid duration/);assert.equal(analyses,0);
  f.wizard.start('generate',{source:{id:'playlists',playlistIds:['source']},recipe:{mode:'songs',songs:3,locks:{0:'0'},analyze:true}});await f.wizard.task;
  assert.match(f.wizard.error,/locked song/);assert.equal(analyses,0);
  f.wizard.start('generate',{source:{id:'playlists',playlistIds:['source']},recipe:{mode:'songs',songs:7,analyze:true}});await f.wizard.task;
  assert.match(f.wizard.error,/Only 6 distinct.*longer than 30 minutes/);assert.equal(analyses,0);
  const d=await draft(f,{mode:'duration',minutes:20});assert.equal(d.exclusions.unknownDuration,1);assert.equal(d.exclusions.tooLong,1);
});
test('read-only generation and autosort preserve source membership, cache analysis and hide paths from UI',async t=>{
  const f=fixture();t.after(()=>f.store.close());
  let analyses=0;f.wizard.analyzer=async()=>{analyses++;return {...await f.options.analyzer()};};
  const a=await draft(f,{analyze:true});await draft(f,{analyze:true});
  assert.equal(analyses,8);assert.equal(a.tracks.length,8);assert.deepEqual(f.playlists.get('source'),['0','1','2','3','4','5','6','7']);
  assert(!f.calls.some(c=>['create','add','import','analyse'].includes(c.method)));
  assert(!JSON.stringify(f.wizard.publicState()).includes('/fixture/'));assert(!JSON.stringify(f.wizard.publicState()).includes('/fixture-usb'));
  f.stamp.mtimeMs=2;await draft(f,{analyze:true});assert.equal(analyses,16,'Changed files invalidate cached analysis');
});
test('new playlist creation verifies exact order, is idempotent, and never edits the source',async t=>{
  const f=fixture();t.after(()=>f.store.close());const d=await draft(f);
  f.wizard.start('create',{id:d.id,name:'Cohesive set'});await f.wizard.task;assert.equal(f.wizard.error,'');
  assert.deepEqual(f.playlists.get('created'),d.tracks.map(t=>t.id));assert.deepEqual(f.playlists.get('source'),['0','1','2','3','4','5','6','7']);
  assert.equal(f.wizard.publicState().draft.write.status,'verified');
  f.wizard.start('create',{id:d.id,name:'Cohesive set'});await f.wizard.task;
  assert.equal(f.calls.filter(c=>c.method==='create').length,1);
});
test('lost add response and restart recover the journaled target without duplicates',async t=>{
  const f=fixture(70);t.after(()=>f.store.close());const d=await draft(f);f.loseAdd();
  f.wizard.start('create',{id:d.id,name:'Resume me'});await f.wizard.task;assert.match(f.wizard.error,/response lost/);
  assert.equal(f.playlists.get('created').length,64);
  const recovered=new Wizard(f.store,f.bridge,f.options);recovered.start('create',{id:d.id,name:'Resume me'});await recovered.task;
  assert.equal(recovered.error,'');assert.deepEqual(f.playlists.get('created'),d.tracks.map(t=>t.id));
  assert.equal(f.calls.filter(c=>c.method==='create').length,1);
});
test('uncertain creation never blindly recreates, unexpected native order stays an explicit partial failure',async t=>{
  const f=fixture();t.after(()=>f.store.close());const d=await draft(f);f.loseCreate();
  f.wizard.start('create',{id:d.id,name:'Uncertain'});await f.wizard.task;
  assert.equal(f.wizard.publicState().draft.write.status,'uncertain');
  f.wizard.start('create',{id:d.id,name:'Uncertain'});await f.wizard.task;assert.match(f.wizard.error,/automatic recreation is blocked/);
  assert.equal(f.calls.filter(c=>c.method==='create').length,1);
  const g=fixture();t.after(()=>g.store.close());const e=await draft(g);g.scramble();g.wizard.start('create',{id:e.id,name:'Partial'});await g.wizard.task;
  assert.match(g.wizard.error,/preserve the generated order/);assert.equal(g.wizard.publicState().draft.write.status,'interrupted');assert.equal(g.playlists.get('created').length,8);
});
test('stale sources, wrong libraries and USB ejection refuse writes',async t=>{
  const f=fixture();t.after(()=>f.store.close());let d=await draft(f);f.tracks.get('0').bpm=130;
  f.wizard.start('create',{id:d.id,name:'Stale'});await f.wizard.task;assert.match(f.wizard.error,/changed/);assert(!f.calls.some(c=>c.method==='create'));
  d=await draft(f);f.setLibrary('other');f.wizard.start('create',{id:d.id,name:'Wrong'});await f.wizard.task;assert.match(f.wizard.error,/Wrong library/);
  f.setLibrary('fixture');const options=await f.wizard.options(),usb=options.sources.find(s=>s.id.startsWith('usb-'));
  f.wizard.start('generate',{source:{id:usb.id,playlistIds:[]},recipe:{mode:'all'}});await f.wizard.task;assert.equal(f.wizard.error,'');d=f.wizard.draft;
  f.setVolume('different-stick');f.wizard.start('create',{id:d.id,name:'USB set'});await f.wizard.task;assert.match(f.wizard.error,/USB identity changed/);
});
test('autosort refuses missing files instead of silently losing songs and serializes work',async t=>{
  const f=fixture();t.after(()=>f.store.close());f.tracks.get('0').missing=true;
  f.wizard.start('generate',{source:{id:'playlists',playlistIds:['source']},recipe:{mode:'all'}});
  assert.throws(()=>f.wizard.start('generate',{}),/Wait for Playlist Wizard/);await f.wizard.task;assert.match(f.wizard.error,/keeps every song/);
  f.wizard.start('generate',{source:{id:'playlists',playlistIds:['source']},recipe:{mode:'songs',songs:3}});await f.wizard.task;
  assert.equal(f.wizard.error,'');assert.equal(f.wizard.draft.tracks.length,3);assert(f.wizard.draft.warnings.some(w=>w.includes('1 unavailable')));
});

test('manual energy corrections survive restart and can be cleared without changing source tags',async t=>{
  const f=fixture();t.after(()=>f.store.close());
  f.wizard.start('generate',{source:{id:'playlists',playlistIds:['source']},recipe:{mode:'all'},overrides:{0:9}});await f.wizard.task;
  assert.equal(f.wizard.draft.tracks.find(t=>t.id==='0').energy,9);
  const restarted=new Wizard(f.store,f.bridge,f.options);restarted.start('generate',{source:{id:'playlists',playlistIds:['source']},recipe:{mode:'all'}});await restarted.task;
  assert.equal(restarted.draft.tracks.find(t=>t.id==='0').energyEvidence,'manual');
  restarted.start('generate',{source:{id:'playlists',playlistIds:['source']},recipe:{mode:'all'},overrides:{0:null}});await restarted.task;
  assert.equal(restarted.draft.tracks.find(t=>t.id==='0').energy,null);assert.equal(f.tracks.get('0').energy,undefined);
});

test('a large source can be analyzed for subset selection, and changed identity prevents caching new features',async t=>{
  const f=fixture(501);t.after(()=>f.store.close());let analyses=0;
  f.wizard.analyzer=async()=>{analyses++;return f.options.analyzer();};
  await draft(f,{mode:'songs',songs:5,analyze:true});assert.equal(analyses,501);assert.equal(f.wizard.draft.coverage.energy,5);
  const g=fixture();t.after(()=>g.store.close());g.wizard.analyzer=async()=>{g.setLibrary('changed');return g.options.analyzer();};
  g.wizard.start('generate',{source:{id:'playlists',playlistIds:['source']},recipe:{mode:'all',analyze:true}});await g.wizard.task;
  assert.match(g.wizard.error,/Wrong library/);assert.equal(g.store.all('wizard-analysis').length,0);
});
