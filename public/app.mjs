import { mountWizard } from './panel.mjs';
let token=location.hash.slice(1)||sessionStorage.getItem('playlist-wizard-token')||'';
if(token){sessionStorage.setItem('playlist-wizard-token',token);history.replaceState(null,'',location.pathname);}
const root=document.getElementById('playlist-wizard-root');let panel,revision=0;
async function api(path,method='GET',body){const r=await fetch('/api/'+path,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const value=await r.json();if(!r.ok)throw Error(value.error||'Request failed');return value;}
async function refresh(){const state=await api('panel');revision=state.revision;if(panel)panel.update(state);else panel=mountWizard(root,state,action);}
async function action(name,args={}){if(name==='close'){window.close();return;}const result=await api('action','POST',{action:name,args});await refresh();return result;}
async function watch(){while(true){try{const value=await api('events?after='+revision);if(value.revision!==revision)await refresh();}catch(e){panel.showError(e.message);await new Promise(r=>setTimeout(r,5000));}}}
try{await refresh();void watch();}catch(e){root.textContent=e.message+' Open the Playlist Wizard shortcut to reconnect.';}
