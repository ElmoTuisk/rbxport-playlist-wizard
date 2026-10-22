export const CURVES = Object.freeze({
  build: [3,4,5,6.5,8,9], waves: [3,6.5,8,4.5,7,9.5],
  hold: [5,8,8.5,8,9,8.5], release: [3,4.5,6,8.5,9,5], down: [8.5,8,6.5,5,4,2.5]
});
const numeric = (value, fallback, min, max, label, integer = false) => {
  const number = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isFinite(number) || number < min || number > max || (integer && !Number.isInteger(number))) throw Error(`Invalid ${label}`);
  return number;
};
export function recipeFrom(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid recipe');
  const mode = value.mode ?? 'all', curve = value.curve ?? 'build';
  if (!['all','songs','duration'].includes(mode)) throw Error('Choose autosort, song count or duration');
  const analysisBackend=value.analysisBackend??'essentia';
  if(!['essentia','basic'].includes(analysisBackend))throw Error('Choose Essentia or Basic audio analysis');
  if (!Object.hasOwn(CURVES, curve) && curve !== 'custom') throw Error('Choose a supported energy curve');
  const anchors = curve === 'custom' ? value.anchors : CURVES[curve];
  if (!Array.isArray(anchors) || anchors.length !== 6 || anchors.some(x => typeof x !== 'number' || !Number.isFinite(x) || x < 1 || x > 10)) throw Error('Custom curves need six energy values from 1 to 10');
  const locks = value.locks ?? {};
  if (!locks || typeof locks !== 'object' || Array.isArray(locks) || Object.keys(locks).length > 500) throw Error('Invalid track locks');
  const seen = new Set();
  for (const [position,id] of Object.entries(locks)) {
    if (!/^(0|[1-9]\d*)$/.test(position) || Number(position) >= 500 || typeof id !== 'string' || !id || id.length > 4096 || seen.has(id)) throw Error('Invalid or repeated track lock');
    seen.add(id);
  }
  const seed = String(value.seed ?? '1');
  if (seed.length > 100) throw Error('Seed is too long');
  return { mode, curve, anchors: [...anchors], songs: mode==='songs'?numeric(value.songs,20,1,500,'song count',true):20,
    minutes: mode==='duration'?numeric(value.minutes,60,1,1440,'duration'):60, overlapBars: numeric(value.overlapBars,32,0,64,'overlap bars',true),
    maxTempoPercent: numeric(value.maxTempoPercent,8,0,30,'maximum tempo adjustment'),
    keyLock: value.keyLock !== false, strictKey: value.strictKey === true, analyze: value.analyze === true,analysisBackend,
    locks: {...locks}, seed };
}
export function targetEnergy(recipe, fraction) {
  const at = Math.max(0,Math.min(1,fraction)) * 5, low = Math.min(4,Math.floor(at));
  return recipe.anchors[low] + (recipe.anchors[low+1]-recipe.anchors[low]) * (at-low);
}
// Camelot conversion is explicit; absent or malformed keys stay unknown.
export function musicalKey(value) {
  const text = String(value || '').trim();
  const camelot = /^(1[0-2]|[1-9])([AB])$/i.exec(text);
  if (camelot) return {number:Number(camelot[1]),mode:camelot[2].toUpperCase()};
  const match = /^([A-G])([#b♯♭]?)(?:\s*(major|minor|maj|min|m))?$/i.exec(text);
  if (!match) return null;
  const naturals = {C:0,D:2,E:4,F:5,G:7,A:9,B:11};
  const pitch = (naturals[match[1].toUpperCase()] + (/[#♯]/.test(match[2])?1:/[b♭]/.test(match[2])?-1:0) + 12) % 12;
  const minor = /^(minor|min|m)$/.test((match[3] || '').toLowerCase());
  return {number:(minor ? [5,12,7,2,9,4,11,6,1,8,3,10] : [8,3,10,5,12,7,2,9,4,11,6,1])[pitch],mode:minor?'A':'B'};
}
export function compatibleKeys(a,b) {
  if (!a || !b) return null;
  const distance = Math.min(Math.abs(a.number-b.number),12-Math.abs(a.number-b.number));
  return (a.mode===b.mode && distance<=1) || (a.number===b.number && a.mode!==b.mode);
}
