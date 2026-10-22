// Popup geometry and sidebar conventions follow the independently licensed Playlist Sync add-on.
export function fitPopover(viewport,anchor,panel,margin=12) {
  const maxWidth=Math.max(0,viewport.width-margin*2),maxHeight=Math.max(0,viewport.height-margin*2);
  return {maxWidth,maxHeight,left:Math.max((viewport.left||0)+margin,Math.min(anchor.right+8,(viewport.left||0)+viewport.width-margin-Math.min(panel.width,maxWidth))),
    top:Math.max((viewport.top||0)+margin,Math.min(anchor.top,(viewport.top||0)+viewport.height-margin-Math.min(panel.height,maxHeight)))};
}
export function installWizardUi(model,mount,css,fit) {
  const key='__rbxportPlaylistWizard';
  if(window[key]&&window[key].version!==2)window[key].dispose();
  if(window[key]){window[key].update(model);const b=document.querySelector('#playlist-wizard-button');return {ready:!!b?.isConnected&&b.getClientRects().length>0};}
  const sheet=new CSSStyleSheet();sheet.replaceSync(css);document.adoptedStyleSheets=[...document.adoptedStyleSheets,sheet];
  const button=document.createElement('button');button.id='playlist-wizard-button';button.type='button';button.title='Playlist Wizard';button.setAttribute('aria-label','Playlist Wizard');
  const icon=document.createElement('span');icon.textContent='✧';icon.setAttribute('aria-hidden','true');
  const label=document.createElement('span');label.textContent='Playlist Wizard';button.append(icon,label);
  const popup=document.createElement('div');popup.id='playlist-wizard-popover';popup.hidden=true;
  const root=document.createElement('div');root.id='playlist-wizard-root';popup.append(root);document.body.append(popup);
  let current=model,sequence=0,frame=null,stopped=false;const pending=new Map();
  const send=(action,args={})=>{
    if(action==='close'){popup.hidden=true;return Promise.resolve();}
    if(typeof window.__playlistWizardAction!=='function')return Promise.reject(Error('Playlist Wizard is disconnected'));
    const id=++sequence;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('Playlist Wizard did not respond'));},15000);pending.set(id,{resolve,reject,timer});window.__playlistWizardAction(JSON.stringify({id,action,args}));});
  };
  const panel=mount(root,model,send);
  function position(){if(popup.hidden||stopped)return;const v=window.visualViewport,l=fit({left:v?.offsetLeft||0,top:v?.offsetTop||0,width:v?.width||window.innerWidth,height:v?.height||window.innerHeight},button.getBoundingClientRect(),{width:410,height:root.scrollHeight+2});Object.assign(popup.style,{left:l.left+'px',top:l.top+'px',maxWidth:l.maxWidth+'px',maxHeight:l.maxHeight+'px'});}
  function decorate(){frame=null;if(stopped)return;const sync=document.querySelector('#playlist-sync-button'),tag=document.querySelector('button[aria-label="Tag List"]');const anchor=sync||tag?.parentElement;
    if(anchor&&anchor.nextElementSibling!==button)anchor.after(button);
    if(tag){button.className=tag.className;label.className=tag.querySelector('span')?.className||'';}position();}
  const open=()=>{panel.update(current);popup.hidden=false;position();};
  button.addEventListener('click',event=>{event.stopPropagation();if(popup.hidden){open();void send('options').catch(e=>panel.showError(e.message));}else popup.hidden=true;});
  button.addEventListener('mousedown',e=>e.stopPropagation());popup.addEventListener('mousedown',e=>e.stopPropagation());
  const outside=event=>{if(!popup.contains(event.target)&&!button.contains(event.target))popup.hidden=true;};
  const escape=event=>{if(event.key==='Escape'&&!popup.hidden){popup.hidden=true;event.stopPropagation();button.focus();}};
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape,true);window.addEventListener('resize',position);
  const observer=new MutationObserver(records=>{if(!records.some(r=>!root.contains(r.target)&&(r.target.closest?.('nav')||[...r.addedNodes,...r.removedNodes].some(n=>n.nodeType===1&&(n.matches?.('nav,#playlist-sync-button,button[aria-label="Tag List"]')||n.querySelector?.('nav,#playlist-sync-button,button[aria-label="Tag List"]'))))))return;if(frame===null)frame=requestAnimationFrame(decorate);});
  observer.observe(document.body,{childList:true,subtree:true});const resize=new ResizeObserver(position);resize.observe(root);
  window.visualViewport?.addEventListener('resize',position);window.visualViewport?.addEventListener('scroll',position);
  const expiry=setInterval(()=>{if(Date.now()>current.expiresAt)dispose();},10000);
  function dispose(){stopped=true;observer.disconnect();resize.disconnect();clearInterval(expiry);if(frame!==null)cancelAnimationFrame(frame);document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape,true);window.removeEventListener('resize',position);window.visualViewport?.removeEventListener('resize',position);window.visualViewport?.removeEventListener('scroll',position);button.remove();popup.remove();for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Playlist Wizard closed'));}document.adoptedStyleSheets=document.adoptedStyleSheets.filter(s=>s!==sheet);delete window[key];}
  window[key]={version:2,open,dispose,update(value){const changed=value.revision!==current.revision;current=value;if(changed&&!popup.hidden)panel.update(value);if(changed)decorate();if(value.open)open();},reply(id,result,error){const p=pending.get(id);if(!p)return;pending.delete(id);clearTimeout(p.timer);error?p.reject(Error(error)):p.resolve(result);}};
  decorate();if(model.open)open();return {ready:button.isConnected&&button.getClientRects().length>0};
}
