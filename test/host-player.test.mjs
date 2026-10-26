import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {hostCommandSource} from '../src/host-commands.mjs';

function fixture() {
  const calls=[],loads=[],row={id:'123',title:'Synthetic review song',durationSec:300,analysed:1,extra:{location:'C:/fixture/song.mp3'}};
  const playerProps={track:null,onEject(){},deck:'a'},tableProps={players:1,onFocusedRow(){},onLoadTrack(deck,track){loads.push({deck,track});playerProps.track=track;state.a={...state.a,loaded:true,playing:false,loadId:2,frames:0};}};
  const player={__reactFiber$fixture:{memoizedProps:playerProps}},table={__reactFiber$fixture:{memoizedProps:tableProps}};
  const state={a:{loaded:false,playing:false,loadId:0,frames:0},b:{playing:true,loadId:5}};
  const pause={disabled:false,click(){calls.push({name:'pause-ui'});state.a.playing=false;}};
  const document={querySelector(selector){return selector.startsWith('section')?player:pause;},querySelectorAll(){return [table];}};
  let library='fixture',volume='usb',failLoad=false;
  const invoke=async(name,args)=>{
    calls.push({name,args});
    if(name==='database_drives')return [{current:true,masterDb:library}];
    if(name==='list_devices')return [{volumeId:volume,path:'X:'}];
    if(name==='device_libraries')return [{format:'oneLibrary'}];
    if(name==='open_view')return {viewId:7,len:1};
    if(name==='view_ids_in_range')return [row.id];
    if(name==='fetch_rows')return [row];
    if(name==='deck_state')return structuredClone(state);
    if(name==='preview_stop')return;
    if(name==='deck_seek'){state.a.frames=0;return;}
    throw Error('Unexpected operation: '+name);
  };
  const window={__TAURI_INTERNALS__:{invoke}},args={libraryId:'fixture',trackId:'123',path:'C:/fixture/song.mp3',duration:300};
  const run=(extra={},globals={})=>runInNewContext(hostCommandSource('cue',{...args,...extra}),{window,document,setTimeout,...globals});
  return {calls,loads,row,state,tableProps,playerProps,player,table,document,window,run,setLibrary:v=>library=v,setVolume:v=>volume=v};
}

test('review load uses the real UI handler, waits for matching audio, and keeps Player 1 paused without touching Player 2',async()=>{
  const f=fixture();f.state.a.playing=true;
  const result=await f.run();
  assert.equal(result.trackId,'123');assert.equal(result.paused,true);assert.equal(f.loads.length,1);
  assert.equal(f.loads[0].deck,'a');assert.equal(f.loads[0].track,f.row);
  assert(f.calls.findIndex(c=>c.name==='pause-ui')<f.calls.findIndex(c=>c.name==='preview_stop'));
  assert.equal(f.playerProps.track.id,'123');assert(f.state.b.playing);assert.equal(f.state.b.loadId,5);
  assert(!f.calls.some(c=>['deck_play','preview_play','deck_load','analyse_track','import_files'].includes(c.name)));
  assert.equal(f.window.__rbxportAddonWriteLease,undefined);
});

test('review load refuses wrong libraries, changed metadata, unavailable files and automatic analysis before changing a deck',async()=>{
  for(const change of [f=>f.setLibrary('wrong'),f=>f.row.extra.location='C:/different.mp3',f=>f.row.missing=true,f=>f.row.durationSec=299,f=>f.row.analysed=0]){
    const f=fixture();change(f);await assert.rejects(f.run());assert.equal(f.loads.length,0);assert(!f.calls.some(c=>c.name==='pause-ui'||c.name==='deck_seek'));
  }
  const f=fixture();f.setVolume('other');await assert.rejects(f.run({device:{volumeId:'usb',path:'X:',format:'oneLibrary'}}),/USB/);assert.equal(f.loads.length,0);
});

test('missing or ambiguous player hooks and active cooperative writes fail without a guessed audio-only fallback',async()=>{
  const f=fixture();f.tableProps.players=0;await assert.rejects(f.run(),/Show Player 1/);assert.equal(f.loads.length,0);
  f.tableProps.players=1;f.window.__rbxportAddonWriteLease={owner:'sync'};
  await assert.rejects(f.run(),/Another add-on/);assert.equal(f.window.__rbxportAddonWriteLease.owner,'sync');assert.equal(f.loads.length,0);
  delete f.window.__rbxportAddonWriteLease;
  const g=fixture();delete g.player.__reactFiber$fixture;await assert.rejects(g.run(),/unavailable/);assert.equal(g.loads.length,0);
});

test('USB review loads use the pinned source and revalidate identity immediately before the UI action',async()=>{
  const f=fixture();f.row.id='file:usb-song';f.row.analysed=0;
  await f.run({trackId:f.row.id,device:{volumeId:'usb',path:'X:',format:'oneLibrary'}});
  assert.equal(f.calls.find(c=>c.name==='open_view').args.spec.source.kind,'device');
  assert.equal(f.calls.find(c=>c.name==='open_view').args.spec.source.format,'oneLibrary');
  assert(f.calls.filter(c=>c.name==='list_devices').length>2);
  assert.equal(f.loads[0].track.id,f.row.id);
});

test('engine readiness cannot be claimed when the UI changes but the new audio never loads',async()=>{
  const f=fixture();f.tableProps.onLoadTrack=(_deck,row)=>{f.playerProps.track=row;};
  let now=0;class FastDate extends Date{static now(){now+=2000;return now;}}
  await assert.rejects(f.run({}, {Date:FastDate,setTimeout:fn=>{fn();}}),/did not confirm/);
  assert(!f.calls.some(c=>c.name==='deck_seek'));assert.equal(f.window.__rbxportAddonWriteLease,undefined);
});
