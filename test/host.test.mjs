import test from 'node:test';
import assert from 'node:assert/strict';
import { hostCommandSource } from '../src/host-commands.mjs';
const evaluate=(method,args,invoke,window={})=>new Function('window','return '+hostCommandSource(method,args))({...window,__TAURI_INTERNALS__:{invoke}});
test('every command validates the current library, USB volume and format before reading or writing',async()=>{
  const calls=[],invoke=async name=>{calls.push(name);if(name==='database_drives')return [{current:true,masterDb:'FIXTURE'}];if(name==='list_devices')return [{volumeId:'new',path:'X:'}];};
  await assert.rejects(evaluate('open',{libraryId:'other'},invoke),/Wrong library/);assert.deepEqual(calls,['database_drives']);
  await assert.rejects(evaluate('add',{libraryId:'fixture',device:{volumeId:'old',path:'X:',format:'oneLibrary'},ids:[]},invoke),/identity changed/);
  assert(!calls.includes('device_playlist_edit'));
  assert.throws(()=>hostCommandSource('create',{name:'x'}),/pinned library/);
  assert.throws(()=>hostCommandSource('delete',{}),/Unsupported/);
});
test('USB all-tracks uses the explicit device namespace, BPM x100 converts, and add preserves argument order',async()=>{
  const calls=[],device={volumeId:'usb',path:'X:',format:'oneLibrary'};
  const invoke=async(name,args)=>{
    calls.push({name,args});if(name==='database_drives')return [{current:true,masterDb:'FIXTURE'}];
    if(name==='list_devices')return [{volumeId:'usb',path:'X:'}];if(name==='device_libraries')return [{format:'oneLibrary'}];
    if(name==='open_view')return {viewId:1,len:2};if(name==='fetch_rows')return [{id:'file:a',title:'A',bpmX100:12850,key:'8A',durationSec:300,extra:{location:'X:/a.mp3'}}];
    if(name==='device_playlist_edit')return {id:'target'};
  };
  await evaluate('open',{libraryId:'fixture',device},invoke);
  assert.deepEqual(calls.find(c=>c.name==='open_view').args.spec.source,{kind:'device',path:'X:',format:'oneLibrary',playlist:'0'});
  const rows=await evaluate('page',{libraryId:'fixture',device,viewId:1,offset:0,count:1},invoke);assert.equal(rows[0].bpm,128.5);
  await evaluate('add',{libraryId:'fixture',device,playlistId:'target',ids:['file:b','file:a']},invoke);
  assert.deepEqual(calls.find(c=>c.name==='device_playlist_edit').args.edit,{kind:'add',playlist:'target',tracks:['file:b','file:a'],duplicates:false});
  assert(calls.every(c=>!['import_files','analyse_track','reorder_playlist','sync_devices'].includes(c.name)));
});
test('shared host write lease refuses a simultaneous writer and releases after a failed native operation',async()=>{
  const source=hostCommandSource('add',{libraryId:'fixture',playlistId:'target',ids:['a']});
  const window={__rbxportAddonWriteLease:{owner:'playlist-sync'},__TAURI_INTERNALS__:{invoke:async name=>{if(name==='database_drives')return [{current:true,masterDb:'FIXTURE'}];throw Error('Native failure');}}};
  await assert.rejects(new Function('window','return '+source)(window),/Another add-on/);assert(window.__rbxportAddonWriteLease);
  delete window.__rbxportAddonWriteLease;await assert.rejects(new Function('window','return '+source)(window),/Native failure/);assert.equal(window.__rbxportAddonWriteLease,undefined);
});
