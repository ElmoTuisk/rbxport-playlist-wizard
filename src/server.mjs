import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { access,mkdir,readFile,writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join,resolve } from 'node:path';
import { homedir } from 'node:os';
import { Installation } from './installation.mjs';
import { Store } from './store.mjs';
import { Bridge } from './bridge.mjs';
import { Wizard } from './wizard.mjs';
import {essentiaStatus} from './essentia-runtime.mjs';
import {watchHostProcess} from './host-lifetime.mjs';
const publicDir=fileURLToPath(new URL('../public/',import.meta.url));
export async function startServer({port=43823,dataDir=join(homedir(),'.rbxport-playlist-wizard'),bridgeClient=null,demo=false,wizardOptions={},hostPid=null,watchHost=watchHostProcess,installationClient=null}={}) {
  if(hostPid!==null&&(!Number.isSafeInteger(hostPid)||hostPid<=0))throw Error('Invalid rbxport process ID');
  let stopHostWatch=null;
  await mkdir(dataDir,{recursive:true});const token=randomBytes(32).toString('hex'),store=new Store(join(dataDir,demo?'wizard-demo.sqlite':'wizard.sqlite'));
  let uninstalling=false;
  const installation=installationClient||new Installation();
  const installationStatus=demo?{canUninstall:false}:await installation.status();
  let revision=1,closing=false,hostTask=null,timer=null,connected=false,connectionError='',closeTask=null;const listeners=new Set();
  const changed=()=>{revision++;for(const listener of [...listeners])listener();clearTimeout(timer);if(!closing&&!demo)timer=setTimeout(()=>{void syncHost().catch(()=>{});},200);};
  const bridge=bridgeClient||(demo?demoBridge():new Bridge(changed));
  const privateFFmpeg=fileURLToPath(new URL('../.runtime/tools/ffmpeg.exe',import.meta.url));
  let ffmpeg=process.env.FFMPEG||'ffmpeg';try{await access(privateFFmpeg);if(!process.env.FFMPEG)ffmpeg=privateFFmpeg;}catch{}
  const wizard=new Wizard(store,bridge,{ffmpeg,changed,...wizardOptions,...(demo?{fileStat:async()=>({isFile:()=>true,size:100,mtimeMs:0,dev:0,ino:0})}:{})});
  const css=await readFile(join(publicDir,'style.css'),'utf8');
  const analysis={essentia:await essentiaStatus()};
  const model=()=>({revision,connected,connectionError,demo,hostPid,analysis,installation:installationStatus,expiresAt:Date.now()+60000,wizard:wizard.publicState()});
  function syncHost(open=false) {
    if(closing)return Promise.resolve();
    if(demo){connected=true;return Promise.resolve({ready:true,libraryReady:true});}
    if(hostTask)return hostTask.then(result=>open?syncHost(true):result);
    hostTask=(async()=>{
      const before=connected,previousError=connectionError;
      try{await bridge.connect();await bridge.call('info');connected=true;connectionError='';}catch(error){connected=false;connectionError=error.message;}
      if(before!==connected||previousError!==connectionError)changed();
      if(!bridge.connected)throw Error(connectionError||'rbxport disconnected');
      return {...await bridge.updateHost({...model(),open},css),libraryReady:connected,connectionError};
    })().finally(()=>{hostTask=null;});return hostTask;
  }
  async function action(name,args={}) {
    if(closing||uninstalling)throw Error('Playlist Wizard is stopping.');
    if(typeof name!=='string'||!args||typeof args!=='object'||Array.isArray(args))throw Error('Invalid action');
    if(name==='uninstall') {
      if(demo)throw Error('Example data only');
      if(args.confirmed!==true)throw Error('Confirm uninstalling Playlist Wizard first.');
      if(wizard.active)throw Error('Finish or cancel the current Wizard operation before uninstalling.');
      uninstalling=true;
      try { const result=await installation.uninstall();setTimeout(()=>{void close();},250).unref();return result; }
      catch(error) { uninstalling=false;throw error; }
    }
    if(name==='connect')return syncHost();
    if(name==='cancel'){if(wizard.active==='cue')throw Error('Wait for the player load to finish; a dispatched host load cannot be cancelled.');wizard.cancel();return {ok:true};}
    if(!connected)throw Error(connectionError||'Connect a compatible rbxport library first');
    if(name==='options'){if(wizard.active)throw Error('Wait for the current operation');return wizard.options();}
    if(name==='generate')return wizard.start('generate',{...args,...(demo?{recipe:{...args.recipe,analyze:false},overrides:demoEnergy()}:{} )});
    if(name==='cue'){if(demo)throw Error('Example data only; no live song can be loaded');return wizard.start('cue',args);}
    if(name==='create'){if(demo)throw Error('Example data only; no live playlist can be created');return wizard.start('create',args);}
    throw Error('Unsupported Playlist Wizard action');
  }
  bridge.onAction=async message=>{
    if(!Number.isSafeInteger(message?.id)||message.id<=0||typeof message.action!=='string')return;
    try{const result=await action(message.action,message.args);await bridge.reply(message.id,result);}
    catch(error){await bridge.reply(message.id,null,error.message).catch(()=>{});}
  };
  const server=createServer(async(req,res)=>{
    const json=(value,status=200)=>{if(res.destroyed)return;res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    try {
      if(req.headers.host!==`127.0.0.1:${port}`)return json({error:'Invalid host'},403);
      const origin=req.headers.origin,allowed=[`http://127.0.0.1:${port}`,'http://tauri.localhost','https://tauri.localhost'];
      if(origin&&!allowed.includes(origin))return json({error:'Origin rejected'},403);
      if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
      if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','GET, POST');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');return res.end();}
      const url=new URL(req.url,`http://127.0.0.1:${port}`);
      if(!url.pathname.startsWith('/api/')) {
        const assets={'/':['index.html','text/html'],'/panel.mjs':['panel.mjs','text/javascript'],'/app.mjs':['app.mjs','text/javascript'],'/style.css':['style.css','text/css']};
        if(req.method!=='GET'||!Object.hasOwn(assets,url.pathname))return json({error:'Not found'},404);
        res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
        const [file,type]=assets[url.pathname];res.setHeader('Content-Type',type+'; charset=utf-8');return res.end(await readFile(join(publicDir,file)));
      }
      const given=Buffer.from(req.headers.authorization?.replace(/^Bearer /,'')||''),expected=Buffer.from(token);
      if(given.length!==expected.length||!timingSafeEqual(given,expected))return json({error:'Pairing code missing or expired. Open the Playlist Wizard launcher again.'},401);
      let body={};if(req.method==='POST'){
        if(!req.headers['content-type']?.startsWith('application/json'))return json({error:'JSON required'},415);
        let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>256*1024)throw Error('Request too large');}body=raw?JSON.parse(raw):{};
      }
      if((uninstalling||closing)&&req.method==='POST')return json({error:'Playlist Wizard is stopping.'},409);
      if(req.method==='GET'&&url.pathname==='/api/panel')return json(model());
      if(req.method==='POST'&&url.pathname==='/api/action')return json(await action(body.action,body.args));
      if(req.method==='POST'&&url.pathname==='/api/ui/open') {
        const result=await syncHost(true);
        if(connected&&!wizard.active)await wizard.options();
        return json(result);
      }
      if(req.method==='POST'&&url.pathname==='/api/shutdown'){if(body.ifIdle===true&&wizard.active)return json({error:'Finish or cancel the current Wizard operation before updating.'},409);closing=true;json({ok:true});setTimeout(()=>{void close();},10);return;}
      if(req.method==='GET'&&url.pathname==='/api/events') {
        if(Number(url.searchParams.get('after'))!==revision)return json({revision});
        if(listeners.size>=12)return json({error:'Too many listeners'},429);
        const finish=()=>{clearTimeout(wait);listeners.delete(finish);json({revision});};
        const wait=setTimeout(finish,25000);listeners.add(finish);res.on('close',()=>{clearTimeout(wait);listeners.delete(finish);});return;
      }
      return json({error:'Not found'},404);
    }catch(error){return json({error:error.message||'Request failed'},400);}
  });
  server.requestTimeout=30000;server.headersTimeout=10000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});port=server.address().port;
  await writeFile(join(dataDir,'launch-url.txt'),`http://127.0.0.1:${port}/#${token}`,{mode:0o600});
  const heartbeat=demo?null:setInterval(()=>{void syncHost().catch(()=>{});},20000);heartbeat?.unref();
  if(demo){connected=true;await wizard.options();}else void syncHost().catch(()=>{});
  stopHostWatch=!demo&&hostPid!==null?watchHost(hostPid,()=>{bridge.close?.();void close();}):null;
  function close(){return closeTask??=(async()=>{closing=true;stopHostWatch?.();clearTimeout(timer);clearInterval(heartbeat);await wizard.close();await hostTask?.catch(()=>{});if(bridge.connected)await bridge.removeHost?.().catch(()=>{});bridge.close?.();for(const listener of [...listeners])listener();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));store.close();})();}
  return {server,store,wizard,bridge,token,url:`http://127.0.0.1:${port}/#${token}`,close};
}
function demoEnergy(){return Object.fromEntries(Array.from({length:24},(_,i)=>['demo-'+i,2+i%9]));}
function demoBridge(){const tracks=Array.from({length:24},(_,i)=>({id:'demo-'+i,title:['Night Signals','Blue Hour','Transit Dub','First Light'][i%4]+' '+(i+1),artist:['Mira Vale','Orion Park','Vela'][i%3],duration:220+i%5*25,bpm:126+i%5,key:['8A','9A','8B'][i%3],path:'demo.mp3'}));return {connected:true,async call(method,args){if(method==='info')return {libraryId:'demo',playlists:[{id:'demo',name:'Fictional DJ crate'}]};if(method==='devices')return [];if(method==='open')return {libraryId:'demo',viewId:1,len:tracks.length,gen:1};if(method==='page')return tracks.slice(args.offset,args.offset+args.count);throw Error('Example data only');}};}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])) {
  const args=process.argv.slice(2),value=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
  const app=await startServer({dataDir:value('--data-dir'),port:value('--port')===undefined?43823:Number(value('--port')),demo:args.includes('--demo'),hostPid:value('--host-pid')===undefined?null:Number(value('--host-pid'))});
  console.log('Playlist Wizard is running on its local paired interface.');
  for(const event of ['SIGINT','SIGTERM'])process.on(event,()=>{void app.close();});
}
