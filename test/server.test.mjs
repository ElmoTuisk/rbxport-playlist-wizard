import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startServer } from '../src/server.mjs';
test('independent API requires its own pairing token, rejects cross-origin requests and keeps demo creation read-only',async t=>{
  const dataDir=await mkdtemp(join(tmpdir(),'playlist-wizard-api-'));
  const app=await startServer({port:0,dataDir,demo:true});t.after(async()=>{await app.close();await rm(dataDir,{recursive:true,force:true});});
  const base=new URL(app.url).origin,headers={Authorization:'Bearer '+app.token,'Content-Type':'application/json'};
  const post=(action,args={})=>fetch(base+'/api/action',{method:'POST',headers,body:JSON.stringify({action,args})});
  assert.equal((await fetch(base+'/api/panel')).status,401);
  assert.equal((await fetch(base+'/api/panel',{headers:{...headers,Origin:'https://untrusted.test'}})).status,403);
  assert.equal((await fetch(base+'/../package.json')).status,404);
  const panel=await(await fetch(base+'/api/panel',{headers})).json();assert.equal(panel.demo,true);assert(panel.wizard.options.sources.length);
  assert.equal((await post('generate',{source:{id:'playlists',playlistIds:['demo']},recipe:{mode:'songs',songs:6}})).status,200);
  await app.wizard.task;assert.equal(app.wizard.draft.tracks.length,6);
  assert.equal((await post('create',{id:app.wizard.draft.id,name:'Do not write'})).status,400);
  assert.equal(app.store.all('wizard-writes').length,0);assert.equal(app.store.all('links').length,0);
});
test('unsupported host keeps its independent panel available but blocks generation and creation',async t=>{
  const dataDir=await mkdtemp(join(tmpdir(),'playlist-wizard-host-api-')),models=[];
  const bridge={connected:false,async connect(){this.connected=true;},async call(){throw Error('Required library API unavailable');},async updateHost(model){models.push(model);return {ready:true};},async reply(){},async removeHost(){},close(){this.connected=false;}};
  const app=await startServer({port:0,dataDir,bridgeClient:bridge});t.after(async()=>{await app.close();await rm(dataDir,{recursive:true,force:true});});
  const base=new URL(app.url).origin,headers={Authorization:'Bearer '+app.token,'Content-Type':'application/json'};
  const post=action=>fetch(base+'/api/action',{method:'POST',headers,body:JSON.stringify({action,args:{}})});
  const connection=await(await post('connect')).json();assert.equal(connection.ready,true);assert.equal(connection.libraryReady,false);
  assert(models.some(m=>m.connected===false));assert.equal((await post('generate')).status,400);assert.equal((await post('create')).status,400);
});

test('launcher opening populates sources before any track scan, analysis or playlist write',async t=>{
  const dataDir=await mkdtemp(join(tmpdir(),'playlist-wizard-launch-api-')),calls=[];
  const bridge={connected:false,async connect(){this.connected=true;},async call(method){
    calls.push(method);
    if(method==='info')return {libraryId:'fixture',playlists:[{id:'p',name:'Fixture playlist'}]};
    if(method==='devices')return [];
    throw Error('Opening the panel must not scan tracks or write playlists');
  },async updateHost(){return {ready:true};},async removeHost(){},close(){this.connected=false;}};
  const app=await startServer({port:0,dataDir,bridgeClient:bridge});t.after(async()=>{await app.close();await rm(dataDir,{recursive:true,force:true});});
  const base=new URL(app.url).origin,headers={Authorization:'Bearer '+app.token,'Content-Type':'application/json'};
  const opened=await fetch(base+'/api/ui/open',{method:'POST',headers,body:'{}'});assert.equal(opened.status,200);
  const model=await(await fetch(base+'/api/panel',{headers})).json();
  assert.equal(model.wizard.options.sources.length,2);assert.equal(model.wizard.options.sources[0].playlists[0].id,'p');
  assert.equal(model.wizard.active,null);assert.equal(model.wizard.draft,null);assert(calls.every(method=>['info','devices'].includes(method)));
});

test('missing Essentia is reported before source scans with no silent Basic substitution',async t=>{
  const dataDir=await mkdtemp(join(tmpdir(),'playlist-wizard-missing-essentia-')),calls=[],previous=process.env.ESSENTIA_DIR;process.env.ESSENTIA_DIR=join(dataDir,'absent');
  const bridge={connected:false,async connect(){this.connected=true;},async call(method){calls.push(method);if(method==='info')return {libraryId:'fixture',playlists:[]};throw Error('Unexpected source operation');},async updateHost(){return {ready:true};},async removeHost(){},close(){this.connected=false;}};
  const app=await startServer({port:0,dataDir,bridgeClient:bridge});t.after(async()=>{await app.close();if(previous===undefined)delete process.env.ESSENTIA_DIR;else process.env.ESSENTIA_DIR=previous;await rm(dataDir,{recursive:true,force:true});});
  const base=new URL(app.url).origin,headers={Authorization:'Bearer '+app.token,'Content-Type':'application/json'};
  await fetch(base+'/api/action',{method:'POST',headers,body:JSON.stringify({action:'connect'})});
  const model=await(await fetch(base+'/api/panel',{headers})).json();assert.equal(model.analysis.essentia.available,false);
  await fetch(base+'/api/action',{method:'POST',headers,body:JSON.stringify({action:'generate',args:{source:{id:'collection'},recipe:{mode:'songs',songs:1,analyze:true}}})});await app.wizard.task;
  assert.match(app.wizard.error,/Essentia is unavailable/);assert(calls.every(c=>c==='info'));assert.equal(app.store.all('wizard-analysis').length,0);
});

test('the exact host session owns Wizard shutdown and pending analysis is cancelled',async t=>{
  const dataDir=await mkdtemp(join(tmpdir(),'playlist-wizard-session-'));
  let exitHost,disposed=0,closed=0;
  const bridge={connected:false,async connect(){this.connected=true;},async call(){return {libraryId:'fixture',playlists:[]};},async updateHost(){return {ready:true};},async removeHost(){},close(){closed++;this.connected=false;}};
  const app=await startServer({port:0,dataDir,bridgeClient:bridge,hostPid:123,watchHost:(pid,exit)=>{assert.equal(pid,123);exitHost=exit;return ()=>disposed++;}});
  t.after(async()=>{await app.close();await rm(dataDir,{recursive:true,force:true});});
  const headers={Authorization:'Bearer '+app.token};
  const panel=await(await fetch(new URL(app.url).origin+'/api/panel',{headers})).json();assert.equal(panel.hostPid,123);
  let cancelCalls=0;const originalClose=app.wizard.close.bind(app.wizard);app.wizard.close=async()=>{cancelCalls++;await originalClose();};
  const controller=new AbortController();app.wizard.controller=controller;
  app.wizard.task=new Promise(resolve=>controller.signal.addEventListener('abort',resolve,{once:true}));
  exitHost();await app.close();await app.close();
  assert.equal(controller.signal.aborted,true);assert.equal(cancelCalls,1);assert.equal(disposed,1);assert(closed>=1);assert.equal(app.server.listening,false);
  await assert.rejects(startServer({port:0,dataDir,hostPid:0}),/Invalid rbxport process/);
});
