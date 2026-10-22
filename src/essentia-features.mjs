// Essentia descriptors are measured; this 1–10 energy mapping is still experimental.
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const clamp=value=>Math.max(0,Math.min(1,value));
const median=values=>{const sorted=values.filter(finite).sort((a,b)=>a-b);return sorted.length?sorted[Math.floor(sorted.length/2)]:null;};
const dispose=result=>{for(const value of Object.values(result||{}))if(typeof value?.delete==='function')value.delete();};
export function energyFromDescriptors(d) {
  if(d.silent)return 1;
  const values=[d.onsetRate,d.danceability,d.centroidHz,d.bassRatio,d.dynamicComplexity];
  if(values.some(value=>!finite(value)))return null;
  const energy=0.35*clamp(d.onsetRate/5)+0.25*clamp(d.danceability/3)+0.2*clamp(d.centroidHz/5000)+0.1*clamp(d.bassRatio/0.6)+0.1*clamp(1-d.dynamicComplexity/15);
  return Math.round((1+9*energy)*10)/10;
}
export function rhythmSummary(result,intervals) {
  const valid=intervals.filter(x=>finite(x)&&x>0),mean=valid.reduce((a,b)=>a+b,0)/Math.max(1,valid.length);
  const spread=Math.sqrt(valid.reduce((a,b)=>a+(b-mean)**2,0)/Math.max(1,valid.length));
  const regularity=valid.length>=8&&mean>0?clamp(1-spread/mean/0.2):null;
  const bpm=finite(result.bpm)&&result.bpm>=60&&result.bpm<=208?result.bpm:null;
  const confidence=finite(result.confidence)&&result.confidence>=0?result.confidence:null;
  // Raw multifeature strength is not a calibrated probability.
  return {bpm,confidence,regularity,acceptedBpm:bpm&&confidence>=1.5&&regularity>=0.6?bpm:null,method:'multifeature'};
}
export function keySummary(result) {
  const key=typeof result.key==='string'&&/^[A-G](?:#|b)?$/.test(result.key)&&['major','minor'].includes(result.scale)?result.key+(result.scale==='minor'?'m':''):null;
  const strength=finite(result.strength)?result.strength:null;
  return {key,strength,acceptedKey:key&&strength>=0.6?key:null,profile:'edma'};
}
export function extractSection(e,samples,{tonal=false}={}) {
  const issues=[];let peak=0;
  for(const value of samples){if(!finite(value))throw Error('Invalid decoded audio');peak=Math.max(peak,Math.abs(value));}
  const duration=samples.length/44100;
  if(peak<1e-7)return {duration,silent:true,energy:1,onsetRate:0,danceability:0,centroidHz:0,bassRatio:0,dynamicComplexity:0,loudnessDb:null,rhythm:null,tonal:null,issues:[]};
  const measure=(name,fn)=>{try{return fn();}catch{issues.push(`${name} unavailable for this excerpt`);return null;}};
  let vector=e.arrayToVector(samples),dynamic;
  try{dynamic=measure('Dynamics',()=>e.DynamicComplexity(vector,0.2,44100));}finally{vector.delete();}
  // Shape descriptors use a peak-normalized copy; absolute loudness stays separate.
  const normalized=new Float32Array(samples.length);for(let i=0;i<samples.length;i++)normalized[i]=samples[i]*0.95/peak;
  vector=e.arrayToVector(normalized);
  let dance,onsets,rhythm=null,key=null;
  try {
    dance=measure('Danceability',()=>e.Danceability(vector,8800,310,44100,1.1));
    onsets=measure('Onsets',()=>e.OnsetRate(vector));
    if(tonal&&duration>=8)rhythm=measure('Beat tracking',()=>{
      const result=e.RhythmExtractor2013(vector,208,'multifeature',60);
      try{return rhythmSummary(result,Array.from(e.vectorToArray(result.bpmIntervals)));}finally{dispose(result);}
    });
    if(tonal&&duration>=4)key=measure('Key',()=>keySummary(e.KeyExtractor(vector,true,4096,4096,36,3500,60,25,0.2,'edma',44100,0.0001,440,'cosine','hann')));
    const centroids=[],bass=[];
    for(let offset=0;offset+4096<=normalized.length;offset+=8820) {
      let frame,windowed,spectrum;
      try {
        frame=e.arrayToVector(normalized.subarray(offset,offset+4096));windowed=e.Windowing(frame,false,4096,'hann',0,true);spectrum=e.Spectrum(windowed.frame,4096);
        centroids.push(e.Centroid(spectrum.spectrum,22050).centroid);bass.push(e.EnergyBandRatio(spectrum.spectrum,44100,20,250).energyBandRatio);
      }finally{spectrum?.spectrum.delete();windowed?.frame.delete();frame?.delete();}
    }
    const result={duration,silent:false,onsetRate:finite(onsets?.onsetRate)?onsets.onsetRate:null,danceability:finite(dance?.danceability)?dance.danceability:null,
      centroidHz:median(centroids),bassRatio:median(bass),dynamicComplexity:finite(dynamic?.dynamicComplexity)?dynamic.dynamicComplexity:null,loudnessDb:finite(dynamic?.loudness)?dynamic.loudness:null,
      rhythm,tonal:key,issues};
    return {...result,energy:energyFromDescriptors(result)};
  }finally{dispose(dance);dispose(onsets);vector.delete();}
}

export function analyzeExcerpts(e,excerpts) {
  const sections={};for(const name of ['intro','body','outro'])sections[name]=extractSection(e,excerpts[name],{tonal:name==='body'});
  const energies=Object.values(sections).map(s=>s.energy).filter(finite);
  return {energy:sections.body.energy,intro:sections.intro.energy,outro:sections.outro.energy,peak:energies.length?Math.max(...energies):null,
    evidence:'essentia-excerpt-estimate',audioFeatures:{backend:'essentia',libraryVersion:e.version,sections,rhythm:sections.body.rhythm,tonal:sections.body.tonal},
    featureWarnings:Object.values(sections).flatMap(s=>s.issues)};
}
