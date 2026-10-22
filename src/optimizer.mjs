import { recipeFrom, targetEnergy, musicalKey, compatibleKeys } from './recipe.mjs';
const known = value => typeof value === 'number' && Number.isFinite(value);
const durationIssue = track => !known(track.duration)||track.duration<=0?'unknownDuration':track.duration>1800?'tooLong':null;
// Apply duration eligibility before analysis/search. Autosort may never drop a song.
export function prepareDurations(pool,recipe) {
  const exclusions={unknownDuration:0,tooLong:0},rejected=[];
  const tracks=pool.filter(track=>{const issue=durationIssue(track);if(!issue)return true;exclusions[issue]++;rejected.push(track);return false;});
  const reasons=[];
  if(exclusions.tooLong)reasons.push(`${exclusions.tooLong} ${exclusions.tooLong===1?'track':'tracks'} longer than 30 minutes`);
  if(exclusions.unknownDuration)reasons.push(`${exclusions.unknownDuration} ${exclusions.unknownDuration===1?'track':'tracks'} with a missing or invalid duration`);
  if(rejected.length&&recipe.mode==='all') {
    const examples=rejected.slice(0,3).map(t=>`“${String(t.title||'Untitled track').slice(0,80)}”`).join(', ');
    throw Error(`Autosort keeps every song. This source contains ${reasons.join(' and ')} (${examples}). Choose different source playlists, or use song count/approximate duration to exclude these tracks.`);
  }
  const rejectedIds=new Set(rejected.map(t=>t.id));
  if(Object.values(recipe.locks).some(id=>rejectedIds.has(id)))throw Error('A locked song has an unknown duration or exceeds 30 minutes. Unlock it or choose another source; locked songs cannot be excluded.');
  const warnings=reasons.map(reason=>`${reason} excluded from selection.`);
  if(!tracks.length)throw Error(`No eligible songs remain. ${warnings.join(' ')} Choose another source.`);
  return {tracks,exclusions,warnings};
}
const hash = value => { let n=2166136261;for (let i=0;i<value.length;i++) n=Math.imul(n^value.charCodeAt(i),16777619);return n>>>0; };
export function overlapSeconds(a,b,recipe) {
  // Each track can donate at most a quarter of its duration to each neighbor.
  if (!a || !b || !known(a.bpm) || !known(b.bpm) || a.bpm<=0 || b.bpm<=0) return 0;
  return Math.min(recipe.overlapBars*4*60/Math.max(a.bpm,b.bpm),a.duration/4,b.duration/4);
}
export function transition(a,b,recipe) {
  if (!a) return {cost:0,allowed:true,reasons:[]};
  const reasons=[];let cost=0,allowed=true;
  if (a.bpm && b.bpm) {
    // A half-time relationship is a suggestion, not zero-cost beat equivalence.
    const choices=[{ratio:b.bpm/a.bpm,half:false},{ratio:b.bpm*2/a.bpm,half:true},{ratio:b.bpm/2/a.bpm,half:true}];
    const best=choices.sort((x,y)=>Math.abs(Math.log(x.ratio))-Math.abs(Math.log(y.ratio)))[0];
    const percent=Math.abs(best.ratio-1)*100;
    if (percent>recipe.maxTempoPercent+1e-8) allowed=false;
    cost+=percent*0.7;
    reasons.push(best.half?'Half/double-time handoff; check the rhythmic feel':`Tempo difference ${percent.toFixed(1)}%`);
    if(best.half) cost+=2;
  } else {cost+=2;reasons.push('Tempo unknown; beatmatching unverified');}
  const harmonic=compatibleKeys(musicalKey(a.key),musicalKey(b.key));
  if (harmonic===false) {cost+=5;reasons.push('Key change; audition the transition');if(recipe.strictKey)allowed=false;}
  if (harmonic===null) {cost+=1.5;reasons.push('Key unknown');if(recipe.strictKey)allowed=false;}
  if (harmonic===true) reasons.push('Compatible key relationship');
  if (!recipe.keyLock && a.bpm && b.bpm && Math.abs(a.bpm-b.bpm)>0.05) {
    reasons.push('Key lock off: tempo adjustment changes pitch; harmonic fit unverified');cost+=2;
    if(recipe.strictKey)allowed=false;
  }
  if (known(a.energy) && known(b.energy)) cost+=Math.abs(a.energy-b.energy)*0.5;
  const outgoing=a.audioFeatures?.sections?.outro,incoming=b.audioFeatures?.sections?.intro;
  if(outgoing&&incoming) {
    if(known(outgoing.energy)&&known(incoming.energy)){const jump=Math.abs(outgoing.energy-incoming.energy);cost+=jump*0.4;reasons.push(`Sampled outro/intro energy change ${jump.toFixed(1)}`);}
    if(known(outgoing.centroidHz)&&known(incoming.centroidHz))cost+=Math.min(2,Math.abs(Math.log2((outgoing.centroidHz+100)/(incoming.centroidHz+100))))*0.6;
    if(known(outgoing.danceability)&&known(incoming.danceability))cost+=Math.min(1,Math.abs(outgoing.danceability-incoming.danceability)/3)*0.5;
    if(known(outgoing.dynamicComplexity)&&known(incoming.dynamicComplexity))cost+=Math.min(1,Math.abs(outgoing.dynamicComplexity-incoming.dynamicComplexity)/12)*0.5;
  }
  if (a.artist && a.artist.toLowerCase()===b.artist?.toLowerCase()) {cost+=2;reasons.push('Repeated artist');}
  if (a.genre && b.genre && a.genre!==b.genre) cost+=0.5;
  return {cost,allowed,reasons};
}
export function describeOrder(tracks,recipe) {
  let elapsed=0,full=0;const rows=[];
  for(let i=0;i<tracks.length;i++) {
    const track=tracks[i],overlap=overlapSeconds(tracks[i-1],track,recipe);
    elapsed-=overlap;const start=elapsed;full+=track.duration;elapsed+=track.duration;
    rows.push({...track,start,overlap,transition:transition(tracks[i-1],track,recipe)});
  }
  const timeline=rows.map(row=>({...row,targetEnergy:targetEnergy(recipe,(row.start+row.duration/2)/Math.max(1,elapsed))}));
  return {tracks:timeline,fullSeconds:full,mixedSeconds:elapsed};
}
export function validateOrder(tracks,pool,recipe) {
  const ids=new Set(pool.map(t=>t.id)),seen=new Set();
  for (const [i,track] of tracks.entries()) {
    if(!ids.has(track.id)||seen.has(track.id))throw Error('Draft contains an unknown or repeated track');
    if(durationIssue(track))throw Error('Draft contains a track with an unknown duration or longer than 30 minutes');
    seen.add(track.id);
    if(i&&!transition(tracks[i-1],track,recipe).allowed)throw Error('Draft violates transition limits');
  }
  if(recipe.mode==='all'&&seen.size!==pool.length)throw Error('Autosort must preserve every source song');
  if(recipe.mode==='songs'&&tracks.length!==recipe.songs)throw Error('Exact song count could not be satisfied');
  if(recipe.mode==='duration'&&Math.abs(describeOrder(tracks,recipe).mixedSeconds-recipe.minutes*60)>Math.max(120,recipe.minutes*3))throw Error('Draft misses the requested duration tolerance');
  for(const [position,id] of Object.entries(recipe.locks))if(tracks[Number(position)]?.id!==id)throw Error('Draft changed a locked song');
}
export async function generate(pool,input,{signal,onProgress=()=>{}}={}) {
  const recipe=recipeFrom(input);
  if (!Array.isArray(pool)||!pool.length||pool.length>10000)throw Error('Choose a pool of 1–10,000 tracks');
  if(pool.some(t=>!t.id))throw Error('Tracks need stable host identities');
  if(new Set(pool.map(t=>t.id)).size!==pool.length)throw Error('Repeated memberships need review before autosorting');
  const eligibility=prepareDurations(pool,recipe);pool=eligibility.tracks;
  if(recipe.mode==='all'&&pool.length>500)throw Error('This first version autosorts up to 500 songs; choose a smaller playlist');
  if(recipe.mode==='songs'&&recipe.songs>pool.length)throw Error(`Only ${pool.length} distinct songs are available. ${eligibility.warnings.join(' ')}`.trim());
  const lockedIds=new Set(Object.values(recipe.locks));
  if([...lockedIds].some(id=>!pool.some(t=>t.id===id)))throw Error('A locked song is no longer in the pool');
  const target=recipe.minutes*60,tolerance=Math.max(120,target*0.05);
  const roughCount=recipe.mode==='all'?pool.length:recipe.mode==='songs'?recipe.songs:Math.min(500,pool.length);
  const averageDuration=pool.reduce((n,t)=>n+t.duration,0)/pool.length;
  const withTempo=pool.filter(t=>t.bpm),averageTempo=withTempo.reduce((n,t)=>n+t.bpm,0)/Math.max(1,withTempo.length);
  const averageOverlap=averageTempo?Math.min(recipe.overlapBars*240/averageTempo,averageDuration/4):0;
  const expectedDuration=recipe.mode==='duration'?target:roughCount*averageDuration-Math.max(0,roughCount-1)*averageOverlap;
  if(Object.keys(recipe.locks).some(x=>Number(x)>=roughCount))throw Error('A locked position exceeds the requested length');
  // A reproducible, evenly spread shortlist bounds subset-search work. Autosort never shortlists.
  let candidates=pool;
  if(recipe.mode!=='all'&&pool.length>600){
    const ranked=[...pool].sort((a,b)=>hash(recipe.seed+a.id)-hash(recipe.seed+b.id)||a.id.localeCompare(b.id));
    candidates=ranked.filter(t=>lockedIds.has(t.id));
    const bins=Array.from({length:10},()=>[]);
    for(const track of ranked)if(!lockedIds.has(track.id))bins[known(track.energy)?Math.min(9,Math.max(0,Math.floor(track.energy-1))):0].push(track);
    while(candidates.length<600&&bins.some(b=>b.length))for(const bin of bins)if(bin.length&&candidates.length<600)candidates.push(bin.pop());
  }
  const byId=new Map(candidates.map(t=>[t.id,t]));
  let beam=[{order:[],used:new Set(),cost:0,seconds:0}],complete=[],expansions=0;
  const deadline=Date.now()+15000;
  const durationScore=state=>state.cost/Math.max(1,state.order.length)+Math.abs(state.seconds-target)/Math.max(1,tolerance)*3;
  for(let position=0;position<roughCount;position++) {
    signal?.throwIfAborted();
    if(Date.now()>deadline)throw Error('No suitable draft found within the search budget; narrow the pool or adjust the limits');
    const next=[];
    for(const state of beam) {
      const last=state.order.at(-1),fixed=recipe.locks[position];
      const options=fixed?[byId.get(fixed)]:candidates;
      const ranked=[];
      for(const track of options) {
        if(!track||state.used.has(track.id)||(!fixed&&lockedIds.has(track.id)))continue;
        const edge=transition(last,track,recipe);if(!edge.allowed)continue;
        const overlap=overlapSeconds(last,track,recipe),seconds=state.seconds+track.duration-overlap;
        const fraction=(state.seconds-overlap+track.duration/2)/Math.max(track.duration,expectedDuration);
        const energy=known(track.energy)?Math.abs(track.energy-targetEnergy(recipe,fraction))*3:2;
        const tie=hash(recipe.seed+':'+position+':'+track.id)/4294967296*0.02;
        ranked.push({track,seconds,cost:state.cost+edge.cost+energy+tie});expansions++;
      }
      ranked.sort((a,b)=>a.cost-b.cost||a.track.id.localeCompare(b.track.id));
      for(const choice of ranked.slice(0,8)) {
        const order=[...state.order,choice.track],used=new Set(state.used);used.add(choice.track.id);
        const entry={order,used,cost:choice.cost,seconds:choice.seconds};
        if(recipe.mode==='duration'&&Math.abs(entry.seconds-target)<=tolerance&&Object.keys(recipe.locks).every(x=>Number(x)<=position))complete.push(entry);
        if(recipe.mode!=='duration'||secondsCanContinue(entry.seconds,target,tolerance))next.push(entry);
      }
    }
    next.sort((a,b)=>a.cost-b.cost);
    beam=next.slice(0,12);
    onProgress({stage:'Sequencing',completed:position+1,total:roughCount});
    // Yield to cancellation, UI updates and the independent service's heartbeat.
    await new Promise(resolve=>setImmediate(resolve));
    if(recipe.mode!=='duration'&&position===roughCount-1)complete=beam;
    if(!beam.length)break;
    if(complete.length>200)complete.sort((a,b)=>durationScore(a)-durationScore(b)).splice(100);
  }
  if(!complete.length)throw Error('No suitable draft found within budget. Adjust tempo/key limits, locks or duration; no constraints were relaxed.');
  complete.sort((a,b)=>recipe.mode==='duration'?durationScore(a)-durationScore(b):a.cost-b.cost);
  const result=describeOrder(complete[0].order,recipe);validateOrder(result.tracks,pool,recipe);
  const coverage={energy:result.tracks.filter(t=>known(t.energy)).length,bpm:result.tracks.filter(t=>t.bpm).length,key:result.tracks.filter(t=>musicalKey(t.key)).length};
  const warnings=[...eligibility.warnings];
  if(coverage.energy<result.tracks.length)warnings.push('Energy is unknown for some tracks. Analyze audio or add local energy overrides to fit the curve.');
  if(coverage.bpm<result.tracks.length)warnings.push('Unknown BPM: tempo limits and overlap duration cannot be verified for every transition.');
  if(coverage.key<result.tracks.length)warnings.push('Some keys are unknown. Harmonic fit is unverified for those transitions.');
  warnings.push('Energy scoring is experimental; audition transitions before a performance.');
  return {...result,recipe,coverage,warnings,exclusions:eligibility.exclusions,search:{pool:pool.length,shortlist:candidates.length,expansions}};
}
function secondsCanContinue(seconds,target,tolerance){return seconds<target+tolerance;}
