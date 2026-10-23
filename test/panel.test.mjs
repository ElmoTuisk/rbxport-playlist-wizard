import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { mountWizard } from '../public/panel.mjs';
import { generate } from '../src/optimizer.mjs';
function fixture(){const events={},calls=[],root={innerHTML:'',addEventListener:(name,fn)=>events[name]=fn};const initial={connected:true,wizard:{options:{sources:[{id:'playlists',name:'Selected playlists',playlists:[{id:'p',name:'My <crate>'}]}]},message:'Ready'}};const mount=runInNewContext('('+mountWizard.toString()+')',{FormData:class{constructor(){return {get:()=> 'New set'};}}});const controller=mount(root,initial,async(action,args)=>{calls.push({action,args});});return {root,events,calls,controller,initial};}
test('compact Wizard offers autosort, count, duration, curves and escaped source names',()=>{
  const f=fixture();assert.match(f.root.innerHTML,/Autosort every song/);assert.match(f.root.innerHTML,/Number of songs/);assert.match(f.root.innerHTML,/Approximate duration/);assert.match(f.root.innerHTML,/My &lt;crate&gt;/);
  f.events.change({target:{name:'mode',value:'songs',tagName:'SELECT'}});assert.match(f.root.innerHTML,/Song count/);
  f.events.change({target:{name:'curve',value:'custom',tagName:'SELECT'}});assert.equal((f.root.innerHTML.match(/data-anchor=/g)||[]).length,6);
});
test('controls pass selected songs and lengths to generation, and disconnected state blocks it',async()=>{
  const f=fixture();f.events.change({target:{dataset:{sourcePlaylist:'p'},checked:true}});
  f.events.change({target:{name:'mode',value:'songs',tagName:'SELECT'}});f.events.input({target:{name:'songs',value:'7',tagName:'INPUT'}});
  f.events.change({target:{name:'analysisBackend',value:'basic',tagName:'SELECT'}});
  await f.events.submit({preventDefault(){},target:{matches:s=>s==='[data-recipe]'}});
  assert.equal(f.calls[0].action,'generate');assert.equal(f.calls[0].args.recipe.songs,'7');assert.deepEqual([...f.calls[0].args.source.playlistIds],['p']);
  assert.equal(f.calls[0].args.recipe.analysisBackend,'basic');
  f.controller.update({...f.initial,connected:false});await f.events.submit({preventDefault(){},target:{matches:()=>true}});assert.equal(f.calls.length,1);assert.match(f.root.innerHTML,/<fieldset disabled/);
});

test('Essentia availability and raw strengths are visible without presenting accuracy percentages',async()=>{
  const f=fixture(),draft=await generate([{id:'a',duration:300,audioFeatures:{backend:'essentia',rhythm:{confidence:3.5},tonal:{strength:0.65},sections:{body:{danceability:2,onsetRate:2.1,centroidHz:1500,dynamicComplexity:3},intro:{energy:3},outro:{energy:6}}}}],{mode:'songs',songs:1});
  f.controller.update({...f.initial,analysis:{essentia:{available:false,message:'Essentia <unavailable>'}},wizard:{...f.initial.wizard,draft:{...draft,id:'a',sourceName:'Fixture'}}});
  assert.match(f.root.innerHTML,/Essentia \(recommended\)/);assert.match(f.root.innerHTML,/Essentia &lt;unavailable&gt;/);assert.match(f.root.innerHTML,/beat strength 3\.50 · key strength 0\.65/);assert.match(f.root.innerHTML,/danceability 2\.0/);
});

test('draft preview shows excluded duration counts without opening transition notes',async()=>{
  const f=fixture(),draft=await generate([{id:'song',title:'Fixture song',duration:300}],{mode:'songs',songs:1});
  f.controller.update({...f.initial,wizard:{...f.initial.wizard,draft:{...draft,id:'draft',sourceName:'Fixture source',exclusions:{tooLong:2,unknownDuration:1,missing:3}}}});
  assert.match(f.root.innerHTML,/<p class="pw-muted" role="status">Excluded from selection: 2 over 30 minutes · 1 with unknown duration · 3 unavailable files\.<\/p>/);
  assert(f.root.innerHTML.indexOf('Excluded from selection:')<f.root.innerHTML.indexOf('Analysis and transition notes'));
});

test('managed uninstall has a separate confirmation, works disconnected and blocks active work',async()=>{
  const f=fixture();
  const click=action=>f.events.click({target:{closest:()=>({dataset:{action}})}});
  assert.doesNotMatch(f.root.innerHTML,/Uninstall…/);
  f.controller.update({...f.initial,connected:false,installation:{canUninstall:true}});
  assert.match(f.root.innerHTML,/Uninstall…/);
  await click('confirm-uninstall');assert.equal(f.calls.length,0);
  await click('review-uninstall');assert.match(f.root.innerHTML,/Uninstall Playlist Wizard\?/);
  assert.match(f.root.innerHTML,/saved settings and Playlist Sync/);
  await click('cancel-uninstall');await click('confirm-uninstall');assert.equal(f.calls.length,0);
  f.controller.update({...f.initial,installation:{canUninstall:true},wizard:{...f.initial.wizard,active:'generate'}});
  await click('review-uninstall');await click('confirm-uninstall');assert.equal(f.calls.length,0);
  f.controller.update({...f.initial,connected:false,installation:{canUninstall:true}});
  await click('review-uninstall');await click('confirm-uninstall');
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].action,'uninstall');assert.equal(f.calls[0].args.confirmed,true);
});
