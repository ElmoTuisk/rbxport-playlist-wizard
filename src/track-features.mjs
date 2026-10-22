import {musicalKey} from './recipe.mjs';
const known=x=>typeof x==='number'&&Number.isFinite(x);
export function applyAnalysis(track,analysis,override) {
  const f=analysis?.audioFeatures,rhythm=f?.rhythm,tonal=f?.tonal;
  const hostBpm=known(track.bpm)&&track.bpm>0?track.bpm:null,hostKey=musicalKey(track.key)?track.key:'';
  const estimatedBpm=known(rhythm?.bpm)&&rhythm.bpm>=60&&rhythm.bpm<=208&&rhythm.confidence>=1.5&&rhythm.regularity>=0.6?rhythm.bpm:null;
  const estimatedKey=musicalKey(tonal?.key)&&tonal.strength>=0.6?tonal.key:'';
  const bpm=hostBpm??estimatedBpm,key=hostKey||estimatedKey;
  const featureWarnings=[...new Set(analysis?.featureWarnings||[])];
  if(hostBpm&&estimatedBpm) {
    const ratios=[estimatedBpm/hostBpm,estimatedBpm*2/hostBpm,estimatedBpm/2/hostBpm];
    if(Math.min(...ratios.map(r=>Math.abs(r-1)))>0.05)featureWarnings.push('Host BPM differs from the Essentia excerpt estimate; host BPM retained.');
  }
  if(hostKey&&estimatedKey&&JSON.stringify(musicalKey(hostKey))!==JSON.stringify(musicalKey(estimatedKey)))featureWarnings.push('Host key differs from the Essentia excerpt estimate; host key retained.');
  return {...track,bpm,key,bpmEvidence:hostBpm?'host metadata':bpm?'Essentia excerpt estimate':'unknown',keyEvidence:hostKey?'host metadata':key?'Essentia excerpt estimate':'unknown',
    energy:override??analysis?.energy??null,energyEvidence:override!==undefined?'manual':analysis?.evidence||'unknown',audioFeatures:f||null,featureWarnings};
}
