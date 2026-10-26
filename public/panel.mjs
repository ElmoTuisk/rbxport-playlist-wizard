/** Independent compact renderer; serialized into the host without imports. */
export function mountWizard(root,initial,send) {
  let model=initial,busy=false,error='',dirty=false,advanced=false,reviewOpen=false,installationOpen=false,uninstallReview=false,uninstallStarted=false,draftId=null;
  const values={source:'playlists',mode:'all',songs:20,minutes:60,curve:'build',analyze:false,analysisBackend:'essentia',overlapBars:32,maxTempoPercent:8,keyLock:true,strictKey:false,seed:'1'};
  let selected=new Set(),locks={},overrides={};
  let playlistName='Wizard set';
  let anchors=[3,4,5,6.5,8,9];
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const minutes=seconds=>`${Math.round(seconds/60)} min`;
  const disabled=()=>uninstallStarted||busy||Boolean(model.wizard?.active)||!model.connected;
  const button=(action,text,extra='')=>`<button type="button" data-action="${action}" ${extra}>${text}</button>`;
  const option=(value,label,current)=>`<option value="${esc(value)}" ${value===current?'selected':''}>${esc(label)}</option>`;
  const number=(value,digits=1)=>typeof value==='number'&&Number.isFinite(value)?value.toFixed(digits):'unknown';
  function featureNotes(t) {
    const f=t.audioFeatures;if(!f)return '';
    const body=f.sections?.body||{},intro=f.sections?.intro||{},outro=f.sections?.outro||{};
    return `<small>Essentia · danceability ${number(body.danceability)} · onsets ${number(body.onsetRate)}/s · brightness ${number(body.centroidHz,0)} Hz · dynamics ${number(body.dynamicComplexity)} dB</small><small>Sampled intro/outro energy ${number(intro.energy)}/${number(outro.energy)} · beat strength ${number(f.rhythm?.confidence,2)} · key strength ${number(f.tonal?.strength,2)}</small>`;
  }
  function curve(draft) {
    const a=draft.recipe.anchors,x=f=>48+Math.max(0,Math.min(1,f))*302,y=e=>132-(e-1)/9*114;
    const wanted=a.map((e,i)=>`${i?'L':'M'}${x(i/5)},${y(e)}`).join(' ');
    let broken=true;const actual=draft.tracks.map(t=>{if(t.energy===null||t.energy===undefined){broken=true;return '';}const command=broken?'M':'L';broken=false;return `${command}${x((t.start+t.duration/2)/draft.mixedSeconds)},${y(t.energy)}`;}).join(' ');
    const dots=draft.tracks.flatMap(t=>(t.curveSamples||[]).filter(s=>s.section!=='body'&&typeof s.energy==='number'&&Number.isFinite(s.energy)).map(s=>`<circle class="pw-achieved" cx="${x((t.start+s.seconds)/draft.mixedSeconds)}" cy="${y(s.energy)}" r="2.2"><title>${esc(t.title)} · ${esc(s.section)} ${number(s.energy)}</title></circle>`)).join('');
    return `<svg class="pw-curve" viewBox="0 0 365 176" role="img" aria-label="Requested energy curve, track estimates and sampled intro/outro energy"><path d="M48,12V140H350" class="pw-axis"/><text x="8" y="26">10</text><text x="20" y="136">1</text><text x="48" y="165">0 min</text><text x="350" y="165" text-anchor="end">${esc(minutes(draft.mixedSeconds))}</text><path d="${wanted}" class="pw-target"/><path d="${actual}" class="pw-achieved"/>${dots}</svg><p class="pw-muted">Dashed: requested · Solid: track estimate/correction${dots?' · Dots: sampled intro/outro':''} (1–10). Gaps mean unknown.</p>`;
  }
  function render() {
    const w=model.wizard||{},draft=w.draft,sources=w.options?.sources||[];
    const excluded=draft?.exclusions||{},exclusionNotes=[];
    if(excluded.tooLong)exclusionNotes.push(`${excluded.tooLong} over 30 minutes`);
    if(excluded.unknownDuration)exclusionNotes.push(`${excluded.unknownDuration} with unknown duration`);
    if(excluded.missing)exclusionNotes.push(`${excluded.missing} unavailable files`);
    const source=sources.find(s=>s.id===values.source),off=disabled()?'disabled':'';
    if(draft&&draft.id!==draftId){
      if(draftId===null){for(const key of Object.keys(values))if(draft.recipe[key]!==undefined)values[key]=draft.recipe[key];anchors=[...draft.recipe.anchors];if(draft.source){values.source=draft.source.id;selected=new Set(draft.source.playlistIds);}}
      draftId=draft.id;dirty=false;locks={...draft.recipe.locks};
    }
    const written=draft?.write?.status==='verified',uncertain=draft?.write?.status==='uncertain';
    root.innerHTML=`<header class="pw-head"><strong>Playlist Wizard</strong>${button('close','×','aria-label="Close Playlist Wizard"')}</header>
      ${!model.connected?`<p class="pw-error" role="alert">${esc(model.connectionError||'Connect rbxport through the Playlist Wizard launcher.')}</p>${button('connect','Reconnect',busy?'disabled':'')}`:''}
      ${(error||w.error)?`<p class="pw-error" role="alert">${esc(error||w.error)}</p>`:''}
      <form data-recipe><fieldset ${off}><label for="pw-source">Music source</label><select id="pw-source" name="source">${sources.map(s=>option(s.id,s.name,values.source)).join('')}</select>
      ${source?.playlists.length?`<details class="pw-more" open><summary>${source.id.startsWith('usb-')?'USB playlists (none selected means all tracks)':'Choose playlists'}</summary><div class="pw-sources">${source.playlists.map(p=>`<label class="pw-check"><input type="checkbox" data-source-playlist="${esc(p.id)}" ${selected.has(p.id)?'checked':''}>${esc(p.name)}</label>`).join('')}</div></details>`:''}
      ${w.options?.usbError?`<p class="pw-muted">${esc(w.options.usbError)}</p>`:''}
      <label for="pw-mode">Length</label><select id="pw-mode" name="mode">${[['all','Autosort every song'],['songs','Number of songs'],['duration','Approximate duration']].map(([v,l])=>option(v,l,values.mode)).join('')}</select>
      ${values.mode==='songs'?`<label>Song count<input name="songs" type="number" min="1" max="500" value="${esc(values.songs)}" required></label>`:values.mode==='duration'?`<label>Target minutes<input name="minutes" type="number" min="1" max="1440" value="${esc(values.minutes)}" required></label>`:'<p class="pw-muted">Keep every song and create a new sorted copy. Up to 500 songs.</p>'}
      <label for="pw-curve">Energy curve</label><select id="pw-curve" name="curve">${[['build','Gradual build'],['waves','Waves'],['hold','Peak and hold'],['release','Rise and release'],['down','Wind down'],['custom','Custom anchors']].map(([v,l])=>option(v,l,values.curve)).join('')}</select>
      ${values.curve==='custom'?`<div class="pw-anchors">${anchors.map((v,i)=>`<label>${i*20}%<input data-anchor="${i}" type="number" min="1" max="10" step="0.1" value="${v}"></label>`).join('')}</div>`:''}
      <label class="pw-check"><input name="analyze" type="checkbox" ${values.analyze?'checked':''}>Analyze local audio for energy and transitions</label>
      <p class="pw-muted">Runs locally; cached results are reused. Host BPM/key are preserved. Essentia can estimate missing values; weak estimates stay unknown.</p>
      <details class="pw-more" data-advanced ${advanced?'open':''}><summary>Advanced</summary>
      <label for="pw-analysis-backend">Audio analysis</label><select id="pw-analysis-backend" name="analysisBackend">${option('essentia','Essentia (recommended)',values.analysisBackend)}${option('basic','Basic intensity estimate',values.analysisBackend)}</select>
      ${model.analysis?.essentia?.available===false?`<p class="pw-muted">${esc(model.analysis.essentia.message||'Install Essentia through Playlist Wizard setup to use this backend.')}</p>`:''}
      <label>Maximum tempo difference (%)<input name="maxTempoPercent" type="number" min="0" max="30" step="0.5" value="${values.maxTempoPercent}"></label>
      <label>Assumed overlap (bars)<input name="overlapBars" type="number" min="0" max="64" value="${values.overlapBars}"></label>
      <label class="pw-check"><input name="strictKey" type="checkbox" ${values.strictKey?'checked':''}>Require known compatible keys</label>
      <label class="pw-check"><input name="keyLock" type="checkbox" ${values.keyLock?'checked':''}>Assume key lock during tempo adjustment</label>
      </details><div class="pw-actions"><button type="submit">${draft?'Regenerate draft':'Generate draft'}</button>${button('options','Refresh sources')}</div></fieldset></form>
      <p class="pw-muted" role="status">${esc(w.message||'Choose a source to begin.')}</p>
      ${w.active?`<div class="pw-progress" aria-live="polite">${esc(w.progress?.stage||(w.active==='cue'?'Loading Player 1, paused…':'Working'))} ${w.progress?`${w.progress.completed} / ${w.progress.total}`:''}</div>${w.active==='cue'?'':button('cancel','Cancel')}`:''}
      ${draft?`<section class="pw-draft"><strong>${esc(draft.sourceName)} · ${draft.tracks.length} songs</strong><p>${minutes(draft.mixedSeconds)} estimated mixed · ${minutes(draft.fullSeconds)} full runtime</p>${exclusionNotes.length?`<p class="pw-muted" role="status">Excluded from selection: ${esc(exclusionNotes.join(' · '))}.</p>`:''}${curve(draft)}
      ${draft.openingWarning?`<p class="pw-error" role="status">${esc(draft.openingWarning)}</p>`:''}<p class="pw-muted">Coverage: energy ${draft.coverage.energy}/${draft.tracks.length} · BPM ${draft.coverage.bpm}/${draft.tracks.length} · key ${draft.coverage.key}/${draft.tracks.length}</p>
      <details class="pw-more"><summary>Analysis and transition notes</summary>${draft.warnings.map(s=>`<p class="pw-muted">${esc(s)}</p>`).join('')}${draft.search.shortlist<draft.search.pool?`<p class="pw-muted">Bounded search: ${draft.search.shortlist} of ${draft.search.pool} candidates considered.</p>`:''}</details>
      <details class="pw-more" data-review ${reviewOpen?'open':''}><summary>Review songs, lock positions or correct energy</summary><ol class="pw-tracks">${draft.tracks.map((t,i)=>`<li><strong>${esc(t.title)}</strong><span>${esc(t.artist)} · ${t.bpm?esc(t.bpm)+' BPM':'BPM unknown'} · ${esc(t.key||'Key unknown')}</span><small>BPM: ${esc(t.bpmEvidence||'host metadata')} · Key: ${esc(t.keyEvidence||'host metadata')}</small><small>${esc(t.transition.reasons.join(' · '))}</small>${featureNotes(t)}${(t.featureWarnings||[]).map(note=>`<small>${esc(note)}</small>`).join('')}<div class="pw-track-actions">${button('cue','▶ Load',`data-track-id="${esc(t.id)}" title="Load into Player 1, paused" aria-label="Load ${esc(t.title)} into Player 1, paused" ${off||model.demo?'disabled':''}`)}${button('lock',locks[i]===t.id?'Unlock position':'Lock position',`data-position="${i}" ${off}`)}<label>Energy<input data-energy="${esc(t.id)}" type="number" min="1" max="10" step="0.1" value="${esc(overrides[t.id]??t.energy??'')}" placeholder="Unknown" ${off}></label></div><small>${esc(t.energyEvidence)}</small></li>`).join('')}</ol></details>
      <p class="pw-muted" data-settings-changed ${dirty?'':'hidden'}>Settings changed. Regenerate and review before creating.</p>
      ${draft.write?`<p role="status">${esc(draft.write.message||draft.write.status)}</p>`:''}
      <form data-create><label>New playlist name<input name="playlistName" maxlength="160" value="${esc(draft.write?.name||playlistName)}" required ${off}></label><button type="submit" ${off||dirty||written||uncertain?'disabled':''}>${written?'Created and verified':draft.write?.targetId?'Resume creation':'Create new playlist'}</button></form>
      </section>`:''}
      ${model.installation?.canUninstall?`<details class="pw-more" data-installation ${installationOpen?'open':''}><summary>Installation</summary><p class="pw-muted">Remove this add-on while keeping your music, playlists, saved settings and Playlist Sync.</p>${uninstallStarted?'<p role="status">Playlist Wizard is uninstalling. Your saved data will be kept.</p>':uninstallReview?`<p>Uninstall Playlist Wizard?</p>${button('confirm-uninstall','Uninstall Playlist Wizard',busy||w.active?'disabled':'')} ${button('cancel-uninstall','Keep installed',busy?'disabled':'')}`:button('review-uninstall','Uninstall…',busy||w.active?'disabled':'')}</details>`:''}<footer class="pw-foot">Independent add-on · experimental 0.1.3</footer>`;
  }
  async function act(action,args={}) {if(busy)return;busy=true;error='';try{return await send(action,args);}catch(e){error=e.message;}finally{busy=false;render();}}
  function markDirty(){dirty=true;const create=root.querySelector?.('[data-create] button[type="submit"]');if(create)create.disabled=true;const notice=root.querySelector?.('[data-settings-changed]');if(notice)notice.hidden=false;}
  function edit(event) {
    const target=event.target;
    if(target.name==='playlistName'){playlistName=target.value;return;}
    if(target.dataset?.sourcePlaylist!==undefined){target.checked?selected.add(target.dataset.sourcePlaylist):selected.delete(target.dataset.sourcePlaylist);markDirty();return;}
    if(target.dataset?.anchor!==undefined){anchors[Number(target.dataset.anchor)]=Number(target.value);markDirty();return;}
    if(target.dataset?.energy!==undefined){overrides[target.dataset.energy]=target.value===''?null:Number(target.value);markDirty();return;}
    if(!Object.hasOwn(values,target.name))return;
    values[target.name]=target.type==='checkbox'?target.checked:target.value;markDirty();
    if(target.name==='source'){selected=new Set();locks={};overrides={};}
    if(['mode','curve','source'].includes(target.name))render();
  }
  root.addEventListener('change',edit);
  root.addEventListener('input',event=>{if(!['SELECT','select'].includes(event.target.tagName))edit(event);});
  root.addEventListener('toggle',event=>{if(event.target.dataset?.advanced!==undefined)advanced=event.target.open;if(event.target.dataset?.review!==undefined)reviewOpen=event.target.open;if(event.target.dataset?.installation!==undefined)installationOpen=event.target.open;},true);
  root.addEventListener('click',async event=>{
    const el=event.target.closest('[data-action]');if(!el||el.disabled)return;
    if(el.dataset.action==='lock'){const i=Number(el.dataset.position),track=model.wizard?.draft?.tracks[i];if(track){if(locks[i]===track.id)delete locks[i];else locks[i]=track.id;dirty=true;render();}return;}
    const action=el.dataset.action;
    if(action==='cue'){if(disabled()||model.demo)return;await act('cue',{id:model.wizard?.draft?.id,trackId:el.dataset.trackId});return;}
    if(action==='review-uninstall'){if(!busy&&!model.wizard?.active){installationOpen=true;uninstallReview=true;render();}return;}
    if(action==='cancel-uninstall'){uninstallReview=false;render();return;}
    if(action==='confirm-uninstall'){
      if(!uninstallReview||busy||model.wizard?.active)return;
      const result=await act('uninstall',{confirmed:true});if(result?.started){uninstallStarted=true;render();}return;
    }
    await act(action);
  });
  root.addEventListener('submit',async event=>{
    event.preventDefault();if(disabled())return;
    if(event.target.matches('[data-recipe]')) {
      values.seed=String(Number(values.seed)+1);
      await act('generate',{source:{id:values.source,playlistIds:[...selected]},recipe:{...values,anchors,locks},overrides});
    }else if(event.target.matches('[data-create]')&&!dirty) {
      await act('create',{id:model.wizard?.draft?.id,name:new FormData(event.target).get('playlistName')});
    }
  });
  const controller={update(value){model=value;render();},showError(message){error=message;render();}};
  render();return controller;
}
