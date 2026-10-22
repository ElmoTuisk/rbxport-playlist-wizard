import { hostCommandSource } from './host-commands.mjs';
import { installWizardUi, fitPopover } from './host-ui.mjs';
import { mountWizard } from '../public/panel.mjs';
export class Bridge {
  constructor(changed=()=>{}) {this.changed=changed;this.sequence=0;this.pending=new Map();this.contexts=new Map();}
  get connected(){return this.socket?.readyState===WebSocket.OPEN;}
  async connect() {
    if(this.connected)return;
    const response=await fetch('http://127.0.0.1:43822/json/list',{signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw Error('Open rbxport through the Playlist Wizard shortcut');
    const pages=await response.json(),page=pages.find(p=>p.type==='page'&&/^https?:\/\/tauri\.localhost\/?(?:#.*)?$/.test(p.url));
    if(!page)throw Error('rbxport main window is unavailable');
    const url=new URL(page.webSocketDebuggerUrl);
    if(!['localhost','127.0.0.1'].includes(url.hostname)||url.port!=='43822')throw Error('Non-local automation target refused');
    url.hostname='127.0.0.1';const socket=new WebSocket(url);this.socket=socket;
    socket.addEventListener('message',event=>{
      let message;try{message=JSON.parse(event.data);}catch{return;}
      if(message.method==='Runtime.executionContextCreated')this.contexts.set(message.params.context.id,message.params.context);
      if(message.method==='Runtime.executionContextsCleared'){this.contexts.clear();this.boundContext=null;this.installed=false;}
      if(message.method==='Runtime.bindingCalled'&&message.params.name==='__playlistWizardAction') {
        const context=this.contexts.get(message.params.executionContextId);
        if(context?.auxData?.frameId===this.mainFrameId&&context.auxData.isDefault&&/^https?:\/\/tauri\.localhost$/.test(context.origin)) {
          try{void this.onAction?.(JSON.parse(message.params.payload));}catch{}
        }
      }
      const pending=this.pending.get(message.id);if(!pending)return;
      clearTimeout(pending.timer);this.pending.delete(message.id);
      const failure=message.error?.message||message.result?.exceptionDetails?.exception?.description||message.result?.exceptionDetails?.text;
      if(failure)pending.reject(Error(String(failure).split(/\r?\n\s*at\s/)[0].replace(/^Error:\s*/,'')));
      else pending.resolve(pending.raw?message.result:message.result?.result?.value);
    });
    socket.addEventListener('close',()=>{if(this.socket===socket){this.close();this.changed();}});
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{socket.close();reject(Error('rbxport connection timed out'));},10000);
      socket.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});
      socket.addEventListener('error',()=>{clearTimeout(timer);reject(Error('Could not connect to rbxport'));},{once:true});
    });
    const tree=await this.request('Page.getFrameTree',{},true);this.mainFrameId=tree.frameTree.frame.id;
    await this.request('Runtime.enable',{},true);
  }
  request(method,params,raw=false) {
    if(!this.connected)return Promise.reject(Error('rbxport disconnected'));
    const id=++this.sequence;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('rbxport operation timed out; its outcome may be uncertain'));},120000);
      this.pending.set(id,{resolve,reject,timer,raw});this.socket.send(JSON.stringify({id,method,params}));
    });
  }
  evaluate(expression){return this.request('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});}
  call(method,args={}){return this.evaluate(hostCommandSource(method,args));}
  async updateHost(model,css) {
    const context=[...this.contexts.values()].find(c=>c.auxData?.frameId===this.mainFrameId&&c.auxData.isDefault&&/^https?:\/\/tauri\.localhost$/.test(c.origin));
    if(!context)throw Error('rbxport main context is unavailable');
    if(this.boundContext!==context.id){await this.request('Runtime.addBinding',{name:'__playlistWizardAction',executionContextId:context.id},true);this.boundContext=context.id;}
    if(this.installed){const result=await this.evaluate(`(()=>{const ui=window.__rbxportPlaylistWizard;if(!ui||ui.version!==2)return {needsInstall:true};ui.update(${JSON.stringify(model)});const b=document.querySelector('#playlist-wizard-button');return {ready:!!b?.isConnected&&b.getClientRects().length>0};})()`);if(!result?.needsInstall)return result;}
    const result=await this.evaluate(`(${installWizardUi.toString()})(${JSON.stringify(model)},${mountWizard.toString()},${JSON.stringify(css)},${fitPopover.toString()})`);
    this.installed=true;return result;
  }
  reply(id,result,error){return this.evaluate(`window.__rbxportPlaylistWizard?.reply(${JSON.stringify(id)},${JSON.stringify(result??null)},${JSON.stringify(error||null)})`);}
  async removeHost(){if(this.connected)await this.evaluate('window.__rbxportPlaylistWizard?.dispose()');}
  close(){const socket=this.socket;this.socket=null;socket?.close();for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('rbxport disconnected'));}this.pending.clear();this.contexts.clear();this.installed=false;this.boundContext=null;}
}
