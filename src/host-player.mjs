// Version-pinned rbxport 1.9.0 UI contract. Use its actual load handler so
// React metadata, waveform and engine stay together; never load audio alone.
export async function cueReviewedTrack(a,invoke,libraryId,device) {
  const fail=message=>{throw Error(message);};
  const guard=async()=>{
    const active=(await invoke('database_drives')).find(d=>d.current);
    if(!active?.masterDb||active.masterDb.replaceAll('\\','/').toLowerCase()!==libraryId)fail('Library changed; player load refused');
    if(a.device){
      const found=(await invoke('list_devices')).find(d=>d.volumeId===a.device.volumeId&&d.path===a.device.path);
      if(!found||!(await invoke('device_libraries',{path:found.path})).some(l=>l.format===a.device.format))fail('USB identity changed; player load refused');
    }
  };
  function propsOf(element,predicate) {
    const key=Object.keys(element||{}).find(k=>k.startsWith('__reactFiber$'));
    let node=key&&element[key];
    for(let n=0;node&&n<80;n++,node=node.return)if(predicate(node.memoizedProps))return node.memoizedProps;
    return null;
  }
  const player=()=>document.querySelector('section[aria-label="Preview player"]');
  const playerProps=()=>propsOf(player(),p=>p&&Object.hasOwn(p,'track')&&(p.deck??'a')==='a'&&typeof p.onEject==='function');
  const handlers=new Set();
  for(const element of document.querySelectorAll('[data-testid="track-scroll"]')) {
    const p=propsOf(element,p=>p&&typeof p.onLoadTrack==='function'&&typeof p.onFocusedRow==='function');
    if(p&&p.players>=1)handlers.add(p.onLoadTrack);
  }
  if(handlers.size!==1||!playerProps())fail('Player 1 load action is unavailable in this rbxport view. Show Player 1 and a track list, then retry.');
  const load=[...handlers][0];
  const source=a.device?{kind:'device',path:device.path,format:a.device.format,playlist:'0'}:{kind:'collection'};
  const view=await invoke('open_view',{spec:{source,sort:'trackNo',descending:false,query:''}});
  if(!Number.isInteger(view.len)||view.len<1||view.len>100000)fail('Cannot safely locate the reviewed song in the current source');
  let index=-1;
  for(let from=0;from<view.len&&index<0;from+=4096) {
    const ids=await invoke('view_ids_in_range',{viewId:view.viewId,from,to:Math.min(view.len-1,from+4095)});
    if(!Array.isArray(ids))fail('Track lookup is unavailable');
    const at=ids.indexOf(a.trackId);if(at>=0)index=from+at;
  }
  if(index<0)fail('Reviewed song is no longer in this library; regenerate the draft');
  const rows=await invoke('fetch_rows',{viewId:view.viewId,offset:index,len:1,extraColumns:['location']});
  const row=rows?.[0],path=x=>String(x||'').replaceAll('\\','/').toLowerCase();
  if(rows?.length!==1||row.id!==a.trackId||row.missing||path(row.extra?.location)!==path(a.path)||row.durationSec!==a.duration)fail('Reviewed song changed or is unavailable; regenerate the draft');
  // The host auto-analyzes an unanalysed desktop track on load. Do not trigger
  // those library/grid writes as a side effect of a review button.
  if(/^\d+$/.test(row.id)&&!(row.analysed>0))fail('Analyze this song in rbxport before loading it from review; automatic library analysis is not started here.');
  await guard();
  const before=await invoke('deck_state'),previousId=playerProps()?.track?.id;
  if(!before?.a||!Number.isSafeInteger(before.a.loadId))fail('Player readiness cannot be verified in this host');
  if(before.a.playing) {
    const pause=document.querySelector('[aria-label="Deck A transport"] button[aria-label="Pause"]');
    if(!pause||pause.disabled)fail('Pause Player 1 before loading a review song');
    // The real UI action also clears its deferred-play intention.
    pause.click();
    const deadline=Date.now()+2000;
    while((await invoke('deck_state')).a.playing){if(Date.now()>deadline)fail('Player 1 did not pause; no new song was loaded');await new Promise(r=>setTimeout(r,50));}
  }
  await guard();
  const currentHandlers=new Set();
  for(const element of document.querySelectorAll('[data-testid="track-scroll"]')){
    const p=propsOf(element,p=>p&&typeof p.onLoadTrack==='function'&&typeof p.onFocusedRow==='function');
    if(p&&p.players>=1)currentHandlers.add(p.onLoadTrack);
  }
  if(currentHandlers.size!==1||!currentHandlers.has(load))fail('Host view changed; retry the player load');
  await invoke('preview_stop');
  load('a',row);
  const deadline=Date.now()+8000;
  while(Date.now()<deadline) {
    await guard();
    const shown=playerProps(),state=await invoke('deck_state');
    if(shown?.track?.id===row.id&&state.a?.loaded&&Number.isSafeInteger(state.a.loadId)&&state.a.loadId>0&&
      (previousId===row.id||state.a.loadId!==before.a.loadId)) {
      if(state.a.playing)fail('Player state changed while loading; inspect Player 1 before retrying');
      await guard();await invoke('deck_seek',{deck:'a',positionMs:0});
      const seekDeadline=Date.now()+1000;
      while(Date.now()<seekDeadline){
        await guard();const checked=await invoke('deck_state');
        if(playerProps()?.track?.id!==row.id||checked.a?.loadId!==state.a.loadId||!checked.a.loaded||checked.a.playing)fail('Player changed before the paused load could be verified');
        if(Math.abs(checked.a.frames)<=1)return {trackId:row.id,deck:'a',paused:true};
        await new Promise(r=>setTimeout(r,50));
      }
      fail('Player 1 did not confirm the start position; inspect the player before retrying');
    }
    await new Promise(r=>setTimeout(r,50));
  }
  fail('Player 1 did not confirm this song loaded and paused. Inspect the player before retrying.');
}
