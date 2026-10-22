import test from 'node:test';
import assert from 'node:assert/strict';
import { recipeFrom,targetEnergy,musicalKey,compatibleKeys } from '../src/recipe.mjs';
import { generate,describeOrder,overlapSeconds,validateOrder,transition } from '../src/optimizer.mjs';
const pool=(n=12)=>Array.from({length:n},(_,i)=>({id:String(i),title:'Song '+i,artist:'Artist '+i,bpm:128,key:'8A',duration:300,energy:2+i%9}));
test('recipes validate finite limits, custom anchors, locks and musical key conversion',()=>{
  for(const value of [{mode:'songs',songs:1.5},{mode:'duration',minutes:Infinity},{curve:'invented'},{curve:'custom',anchors:[1,2]},{maxTempoPercent:-1},{locks:{'-1':'x'}},{locks:{0:'x',1:'x'}}])assert.throws(()=>recipeFrom(value));
  assert.doesNotThrow(()=>recipeFrom({mode:'all',songs:'',minutes:'invalid hidden field'}));
  assert.deepEqual(musicalKey('Am'),{number:8,mode:'A'});assert.deepEqual(musicalKey('C major'),{number:8,mode:'B'});
  assert.deepEqual(musicalKey('Db MINOR'),{number:12,mode:'A'});assert.equal(musicalKey('nonsense'),null);
  assert.equal(compatibleKeys(musicalKey('12A'),musicalKey('1A')),true);
  assert.equal(compatibleKeys(musicalKey('8A'),musicalKey('8B')),true);
  assert.equal(compatibleKeys(null,musicalKey('8A')),null);
  assert.equal(targetEnergy(recipeFrom({curve:'down'}),0),8.5);
  assert.equal(recipeFrom({}).analysisBackend,'essentia');assert.throws(()=>recipeFrom({analysisBackend:'remote-service'}),/Essentia or Basic/);
});

test('sampled Essentia outro/intro descriptors influence cost without adding hidden hard constraints',()=>{
  const recipe=recipeFrom({}),[a,b]=pool(2),section={energy:8,centroidHz:3000,danceability:2,dynamicComplexity:3};
  a.audioFeatures={sections:{outro:section}};b.audioFeatures={sections:{intro:{...section}}};
  const smooth=transition(a,b,recipe);b.audioFeatures.sections.intro={energy:2,centroidHz:200,danceability:0.2,dynamicComplexity:10};
  const changed=transition(a,b,recipe);assert(changed.cost>smooth.cost);assert.equal(changed.allowed,true);assert(changed.reasons.some(s=>s.includes('Sampled outro/intro')));
  delete b.audioFeatures;assert(!transition(a,b,recipe).reasons.some(s=>s.includes('Sampled outro/intro')));
});
test('autosort preserves every ID, fits a build and reproduces an identical seed',async()=>{
  const tracks=pool(8).reverse(),recipe={mode:'all',seed:'repeat'};
  const a=await generate(tracks,recipe),b=await generate(tracks,recipe);
  assert.deepEqual(a.tracks.map(t=>t.id).sort(),tracks.map(t=>t.id).sort());
  assert.deepEqual(a.tracks,b.tracks);assert(a.tracks[0].energy<a.tracks.at(-1).energy);
  assert.equal(a.coverage.energy,8);assert(a.mixedSeconds<a.fullSeconds);
});
test('song count is exact, fixed positions survive and unavailable counts are explained',async()=>{
  const result=await generate(pool(),{mode:'songs',songs:5,locks:{0:'4',4:'2'}});
  assert.equal(result.tracks.length,5);assert.equal(result.tracks[0].id,'4');assert.equal(result.tracks[4].id,'2');
  await assert.rejects(generate(pool(2),{mode:'songs',songs:3}),/Only 2 distinct/);
  await assert.rejects(generate(pool(),{mode:'songs',songs:5,locks:{5:'2'}}),/position exceeds/);
});
test('duration uses clamped overlaps and fits the visible tolerance',async()=>{
  const recipe=recipeFrom({mode:'duration',minutes:20});const result=await generate(pool(),recipe);
  assert(Math.abs(result.mixedSeconds-1200)<=120);assert.equal(result.fullSeconds,result.tracks.length*300);
  assert.equal(overlapSeconds({bpm:60,duration:20},{bpm:60,duration:20},recipe),5);
  assert.equal(overlapSeconds({duration:20},{bpm:60,duration:20},recipe),0);
  const described=describeOrder([{id:'long',duration:600,bpm:128},{id:'short',duration:60,bpm:128}],recipe);
  assert(described.tracks[0].targetEnergy>3);assert(described.tracks[1].targetEnergy>described.tracks[0].targetEnergy);
  await assert.rejects(generate(pool(2),{mode:'duration',minutes:60}),/No suitable draft/);
});
test('impossible tempo and strict key constraints never relax themselves',async()=>{
  const tracks=pool(2);tracks[1].bpm=150;
  await assert.rejects(generate(tracks,{mode:'all',maxTempoPercent:0}),/No suitable draft/);
  tracks[1].bpm=128;tracks[1].key='';
  await assert.rejects(generate(tracks,{mode:'all',strictKey:true}),/No suitable draft/);
  const unknown=await generate(tracks.map(t=>({...t,bpm:null,energy:null})),{mode:'all'});
  assert.equal(unknown.coverage.energy,0);assert(unknown.warnings.some(x=>x.includes('tempo limits')));
});
test('independent validator rejects membership, duplicate, lock and hard-limit violations',()=>{
  const tracks=pool(3),recipe=recipeFrom({mode:'all',locks:{0:'0'}});
  assert.throws(()=>validateOrder([tracks[0],tracks[0],tracks[2]],tracks,recipe),/repeated/);
  assert.throws(()=>validateOrder([tracks[1],tracks[0],tracks[2]],tracks,recipe),/locked/);
  assert.throws(()=>validateOrder(tracks.slice(1),tracks,recipe),/every source/);
  assert.throws(()=>validateOrder([{...tracks[0],duration:1801},...tracks.slice(1)],tracks,recipe),/longer than 30 minutes/);
});

test('subset generation excludes ineligible durations and discloses them for song count and set length',async()=>{
  const tracks=[...pool(),...[7338,6989,0,null,NaN,Infinity,-1].map((duration,i)=>({id:'excluded-'+i,title:'Ineligible '+i,duration,bpm:128,key:'8A'}))];
  for(const recipe of [{mode:'songs',songs:5},{mode:'duration',minutes:20}]) {
    const result=await generate(tracks,recipe);
    assert(result.tracks.every(t=>Number.isFinite(t.duration)&&t.duration>0&&t.duration<=1800));
    assert.deepEqual(result.exclusions,{tooLong:2,unknownDuration:5});
    assert(result.warnings.some(w=>w.includes('2 tracks longer than 30 minutes')));
    assert(result.warnings.some(w=>w.includes('5 tracks with a missing or invalid duration')));
    assert.equal(result.search.pool,12);
    if(recipe.mode==='songs')assert.equal(result.tracks.length,5);
  }
  const boundary=await generate([{id:'boundary',duration:1800}],{mode:'songs',songs:1});assert.equal(boundary.tracks.length,1);
});

test('invalid durations never silently remove autosort or locked songs and insufficient pools explain exclusions',async()=>{
  const tracks=[...pool(2),{id:'mix',title:'Long fixture mix',duration:7338}];
  await assert.rejects(generate(tracks,{mode:'all'}),/Autosort keeps every song.*1 track longer than 30 minutes.*Long fixture mix.*song count/);
  await assert.rejects(generate(tracks,{mode:'songs',songs:1,locks:{0:'mix'}}),/locked song.*Unlock/);
  await assert.rejects(generate(tracks,{mode:'songs',songs:3}),/Only 2 distinct.*1 track longer than 30 minutes/);
  await assert.rejects(generate([{id:'unknown',duration:0}],{mode:'songs',songs:1}),/No eligible songs remain.*missing or invalid duration/);
});
test('cancellation yields before completing a long optimization and large autosort never drops tracks',async()=>{
  const controller=new AbortController();
  await assert.rejects(generate(pool(100),{mode:'all'},{signal:controller.signal,onProgress:()=>controller.abort()}),/abort/i);
  await assert.rejects(generate(pool(501),{mode:'all'}),/up to 500/);
  const tracks=pool(800),a=await generate(tracks,{mode:'songs',songs:4,locks:{0:'799'}});
  assert.equal(a.tracks[0].id,'799');assert.equal(a.search.shortlist,600);assert.equal(a.search.pool,800);
});
