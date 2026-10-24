import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, stat, symlink, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { installerProducts, installJavaScriptPayload, validateInstallerPayload, encodeInstallerPayload, decodeInstallerPayload } from '../scripts/Installer.mjs';
import { createWindowsOps } from '../scripts/Installer-Windows.mjs';
import { buildJavaScriptInstaller } from '../scripts/Build-JavaScript-Installer.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex'), bytes=s=>Buffer.from(s);
const json=async p=>JSON.parse((await readFile(p,'utf8')).replace(/^\uFEFF/,''));
const present=async p=>{try{await stat(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
const nodeBytes=bytes('synthetic node; never executed'),toolBytes=bytes('synthetic tool; never executed'),archiveBytes=bytes('synthetic archive; fake adapter only');
function analysis(){
 const files={},chunks=[];
 for(const [name,text]of Object.entries({'essentia-core.cjs':'core','essentia-wasm.cjs':'wasm','LICENSE-Essentia.txt':'license'})){
  const entry='package/'+name,b=bytes(text),h=Buffer.alloc(512);h.write(entry);h.write(b.length.toString(8).padStart(11,'0'),124);h[156]=48;chunks.push(h,b,Buffer.alloc((512-b.length%512)%512));files[name]={entry,sha256:hash(b)};
 }return {archive:gzipSync(Buffer.concat([...chunks,Buffer.alloc(1024)])),files};
}
function payload(slug,{version='1.2.3',node=nodeBytes,archive=archiveBytes,extra=[]}={}){
 const deps={node:{url:'https://nodejs.org/dist/fixture/node.exe',sha256:hash(node)},ffmpeg:{url:'https://www.gyan.dev/fixture.zip',sha256:hash(archive),ffmpegSha256:hash(toolBytes),ffprobeSha256:hash(toolBytes)}};
 if(slug.endsWith('sync'))deps.ytdlp={url:'https://github.com/yt-dlp/fixture.exe',sha256:hash(toolBytes)};
 else{const a=analysis();deps.essentia={url:'https://registry.npmjs.org/essentia.js/-/fixture.tgz',sha256:hash(a.archive),files:a.files};}
 return {schema:1,product:slug,version,files:[['package.json',JSON.stringify({name:slug+'-addon',version})],['dependencies.json',JSON.stringify(deps)],['src/server.mjs','// synthetic; never executed'],['scripts/Start-Rbxport.mjs','// synthetic; never executed'],[`Uninstall-${installerProducts[slug].id}.ps1`,'# synthetic; never executed'],...extra].map(([path,content])=>({path,content:bytes(content).toString('base64'),sha256:hash(bytes(content))}))};
}
async function fixture(t){
 const folder=await mkdtemp(join(tmpdir(),'rbxport-js-install-')),root=await realpath(folder);t.after(()=>rm(root,{recursive:true,force:true}));
 const local=join(root,'Local'),cache=join(root,'Cache');await mkdir(local);await mkdir(cache);await writeFile(join(root,'rbxport.exe'),'synthetic host; never executed');
 const registry=new Map(),state={processes:[],userPort:null};
 async function links(paths){return Promise.all(paths.map(async path=>await present(path)?{path,exists:true,bytes:(await readFile(path)).toString('base64'),properties:await json(path)}:{path,exists:false}));}
 const ops={async call(slug,action,data={}){
  if(action==='inventory')return {local,desktop:join(root,'Desktop'),programs:join(root,'Programs'),startup:join(root,'Startup'),hostCandidates:[join(root,'rbxport.exe')],processes:state.processes,userPort:state.userPort,registeredRoot:registry.get(slug)?.InstallLocation,registry:registry.get(slug)??null};
  if(action==='signature')return {valid:true};
  if(action==='ffmpeg'){for(const n of ['ffmpeg.exe','ffprobe.exe'])await writeFile(join(data.directory,n),toolBytes);return {extracted:true};}
  if(action==='links')return links(data.paths);
  if(action==='write-links'){for(const e of data.entries)await writeFile(e.path,JSON.stringify(e.properties));return links(data.entries.map(e=>e.path));}
  if(action==='registry'){if(data.values)registry.set(slug,data.values);else registry.delete(slug);return {written:true};}
  throw Error('Unknown fake operation');
 }};
 for(const [name,data]of [['node.exe',nodeBytes],['ffmpeg-essentials.zip',archiveBytes],['yt-dlp.exe',toolBytes],['essentia.js-0.1.3.tgz',analysis().archive]])await writeFile(join(cache,name),data);
 return {root,local,cache,ops,registry,state,options:{ops,cacheDirectory:cache,offline:true,isListening:async()=>false}};
}
for(const order of [['rbxport-playlist-sync','rbxport-playlist-wizard'],['rbxport-playlist-wizard','rbxport-playlist-sync']])test(`JavaScript setup independently installs ${order.join(' then ')}`,async t=>{
 const f=await fixture(t);
 for(const [index,slug]of order.entries()){
  const result=await installJavaScriptPayload(payload(slug),f.options);assert.equal(result.shortcuts,2);
  const record=await json(join(result.root,'installed.json'));assert.equal(record.product,slug);assert.equal(record.installMethod,'javascript');for(const e of record.files)assert.equal(hash(await readFile(join(result.root,e.path))),e.sha256);
  const state=await json(join(f.local,'rbxport-addons/startup.json'));assert.equal(state.addons.length,index+1);assert.equal(state.hostExecutable,join(f.root,'rbxport.exe'));
  for(const path of [join(f.root,'Desktop/rbxport.lnk'),join(f.root,'Programs/rbxport.lnk')]){const link=await json(path);assert.match(link.target,/node\.exe$/);assert.match(link.arguments,/Start-Rbxport\.mjs/);assert.equal(link.windowStyle,7);assert.equal(link.icon,join(f.root,'rbxport.exe')+',0');}
 }assert.equal(f.registry.size,2);assert.deepEqual((await readdir(f.cache)).filter(n=>n.startsWith('transaction-')),[]);
});
test('JavaScript update retains custom installation/data, edits and shared runtime',async t=>{
 const f=await fixture(t),slug='rbxport-playlist-sync',directory=join(f.root,'Portable copy'),dataDirectory=join(f.root,'Saved elsewhere');await mkdir(dataDirectory);await writeFile(join(dataDirectory,'sync.sqlite'),'private fixture state');
 await installJavaScriptPayload(payload(slug,{extra:[['scripts/remove-me.mjs','old'],['scripts/edited-old.mjs','original']]}),{...f.options,directory,dataDirectory});
 await writeFile(join(directory,'scripts/edited-old.mjs'),'user modification');await writeFile(join(directory,'song.mp3'),'music sentinel');await writeFile(join(directory,'unknown.txt'),'unknown sentinel');
 const node=join(f.local,'rbxport-addons/runtime',hash(nodeBytes),'node.exe'),before=(await stat(node)).mtimeMs,result=await installJavaScriptPayload(payload(slug,{version:'1.2.4'}),f.options);
 assert.equal(result.root,directory);assert.equal(result.dataDirectory,dataDirectory);assert.equal(await readFile(join(dataDirectory,'sync.sqlite'),'utf8'),'private fixture state');assert.equal(await present(join(directory,'scripts/remove-me.mjs')),false);assert.equal(await readFile(join(directory,'scripts/edited-old.mjs'),'utf8'),'user modification');assert.equal(await readFile(join(directory,'song.mp3'),'utf8'),'music sentinel');assert.equal(await readFile(join(directory,'unknown.txt'),'utf8'),'unknown sentinel');assert.equal((await stat(node)).mtimeMs,before);
 await assert.rejects(installJavaScriptPayload(payload(slug),{...f.options,dataDirectory:join(f.root,'wrong-data')}),/saved-data/);
});
test('setup validates payload paths/checksums, duplicate names and existing saved-data identity',async t=>{
 const f=await fixture(t),slug='rbxport-playlist-sync';
 for(const mutate of [p=>p.files[0].path='../escape.mjs',p=>p.files[0].path='.local-data/sync.sqlite',p=>p.files[0].path='scripts/launch-url.txt',p=>p.files[0].path='docs/.private.md',p=>p.files[0].sha256='0'.repeat(64),p=>p.files.push({...p.files[0],path:p.files[0].path.toUpperCase()})]){const p=payload(slug);mutate(p);assert.throws(()=>validateInstallerPayload(p));}
 const directory=join(f.root,'existing');await mkdir(join(directory,'src'),{recursive:true});await writeFile(join(directory,'package.json'),JSON.stringify({name:slug+'-addon'}));await writeFile(join(directory,'src/server.mjs'),'');await writeFile(join(directory,'installed.json'),JSON.stringify({product:slug,schema:1,installDirectory:directory,files:[]}));
 await assert.rejects(installJavaScriptPayload(payload(slug),{...f.options,directory}),/saved-data/);assert.equal(await present(join(f.local,'rbxport-addons')),false);
});
test('setup refuses running hosts, customized shortcuts, foreign services and invalid runtime trust',async t=>{
 const f=await fixture(t),slug='rbxport-playlist-sync',p=payload(slug);
 f.state.processes=[{name:'rbxport.exe',pid:123}];await assert.rejects(installJavaScriptPayload(p,f.options),/Close rbxport/);f.state.processes=[];
 await assert.rejects(installJavaScriptPayload(p,{...f.options,isListening:async()=>true}),/unrelated/);
 await assert.rejects(installJavaScriptPayload(p,{...f.options,ops:{call:(s,a,d)=>a==='signature'?{valid:false}:f.ops.call(s,a,d)}}),/publisher signature/);
 await mkdir(join(f.root,'Desktop'),{recursive:true});const path=join(f.root,'Desktop/rbxport.lnk'),custom={target:join(f.root,'rbxport.exe'),arguments:'--custom',description:'personal shortcut'};await writeFile(path,JSON.stringify(custom));
 await assert.rejects(installJavaScriptPayload(p,f.options),/customized/);assert.deepEqual(await json(path),custom);assert.equal(await present(join(f.local,'Programs',slug,'package.json')),false);
});
test('failed registry commit restores program files, original links and registrations',async t=>{
 const f=await fixture(t),slug='rbxport-playlist-sync';await installJavaScriptPayload(payload(slug),f.options);
 const root=join(f.local,'Programs',slug),state=join(f.local,'rbxport-addons/startup.json'),link=join(f.root,'Desktop/rbxport.lnk'),before={record:await readFile(join(root,'installed.json'),'utf8'),state:await readFile(state,'utf8'),link:await readFile(link,'utf8'),registry:structuredClone(f.registry.get(slug))};
 const ops={call:async(s,a,d)=>{if(a==='registry'&&d.values?.DisplayVersion==='1.2.4')throw Error('Synthetic registry failure');return f.ops.call(s,a,d);}};
 await assert.rejects(installJavaScriptPayload(payload(slug,{version:'1.2.4'}),{...f.options,ops}),/Synthetic registry/);assert.equal(await readFile(join(root,'installed.json'),'utf8'),before.record);assert.equal(await readFile(state,'utf8'),before.state);assert.equal(await readFile(link,'utf8'),before.link);assert.deepEqual(f.registry.get(slug),before.registry);
});
test('paired idle-only update refuses active Wizard work and stops only its own idle service',async t=>{
 const f=await fixture(t),slug='rbxport-playlist-wizard',installed=await installJavaScriptPayload(payload(slug),f.options);await mkdir(installed.dataDirectory,{recursive:true});await writeFile(join(installed.dataDirectory,'service.pid'),'12345');await writeFile(join(installed.dataDirectory,'launch-url.txt'),'http://127.0.0.1:43823/#'+'a'.repeat(64));
 f.state.processes=[{pid:12345,name:'node.exe',path:join(installed.root,'.runtime/node.exe'),command:'"'+join(installed.root,'.runtime/node.exe')+'" "'+join(installed.root,'src/server.mjs')+'"'}];
 let active=true,listening=true;const calls=[],options={...f.options,isListening:async()=>listening,fetchImpl:async(input,request)=>{const path=new URL(input).pathname;calls.push(path);assert.equal(request.headers.Authorization,'Bearer '+'a'.repeat(64));if(path==='/api/panel')return Response.json({connected:false,wizard:{active}});assert.equal(path,'/api/shutdown');assert.deepEqual(JSON.parse(request.body),{ifIdle:true});listening=false;return Response.json({ok:true});}};
 await assert.rejects(installJavaScriptPayload(payload(slug,{version:'1.2.4'}),options),/active operation/);assert.deepEqual(calls,['/api/panel']);active=false;await installJavaScriptPayload(payload(slug,{version:'1.2.4'}),options);assert.deepEqual(calls,['/api/panel','/api/panel','/api/shutdown']);
});
test('a partially failed shortcut operation restores earlier links and program files',async t=>{
 const f=await fixture(t),slug='rbxport-playlist-sync';await installJavaScriptPayload(payload(slug),f.options);const link=join(f.root,'Desktop/rbxport.lnk'),record=join(f.local,'Programs',slug,'installed.json'),before={link:await readFile(link,'utf8'),record:await readFile(record,'utf8')};
 const ops={call:async(s,a,d)=>{if(a==='write-links'){await f.ops.call(s,a,{entries:d.entries.slice(0,1)});throw Error('Synthetic partial shortcut failure');}return f.ops.call(s,a,d);}};
 const newNode=bytes('updated synthetic runtime; never executed');await writeFile(join(f.cache,'node.exe'),newNode);
 await assert.rejects(installJavaScriptPayload(payload(slug,{version:'1.2.4',node:newNode}),{...f.options,ops}),/Synthetic partial/);assert.equal(await readFile(link,'utf8'),before.link);assert.equal(await readFile(record,'utf8'),before.record);assert.equal(await present(join(f.local,'rbxport-addons/runtime',hash(newNode),'node.exe')),false);
});
test('cancellation, corrupt caches and foreign redirects never commit program files',async t=>{
 const f=await fixture(t),slug='rbxport-playlist-sync';assert.deepEqual(await installJavaScriptPayload(payload(slug),{...f.options,confirm:async()=>false}),{cancelled:true});assert.equal(await present(join(f.local,slug+'-setup-lock')),false);
 await writeFile(join(f.cache,'node.exe'),'corrupt');await assert.rejects(installJavaScriptPayload(payload(slug),f.options),/offline dependency/);
 let requests=0;await assert.rejects(installJavaScriptPayload(payload(slug),{...f.options,offline:false,fetchImpl:async()=>{requests++;return new Response(null,{status:302,headers:{location:'http://foreign.example/node.exe'}});}}),/redirect/);assert.equal(requests,1);assert.equal(await present(join(f.local,'Programs',slug,'installed.json')),false);
});
test('setup lock excludes a concurrent update and cancellation restores changed program files',async t=>{
 const f=await fixture(t),slug='rbxport-playlist-sync';let entered,release;const seen=new Promise(r=>entered=r),hold=new Promise(r=>release=r);
 const ops={call:async(s,a,d)=>{if(a==='signature'){entered();await hold;}return f.ops.call(s,a,d);}};
 const pending=installJavaScriptPayload(payload(slug),{...f.options,ops});await seen;
 await assert.rejects(installJavaScriptPayload(payload(slug),f.options),/Another setup/);release();await pending;
 const root=join(f.local,'Programs',slug),before=await readFile(join(root,'installed.json'),'utf8'),controller=new AbortController();
 await assert.rejects(installJavaScriptPayload(payload(slug,{version:'1.2.4'}),{...f.options,signal:controller.signal,progress:m=>{if(m.startsWith('Installing'))controller.abort(Error('Synthetic cancellation'));}}),/Synthetic cancellation/);
 assert.equal(await readFile(join(root,'installed.json'),'utf8'),before);assert.equal(await present(join(f.local,slug+'-setup-lock')),false);
});
test('setup refuses linked destinations and forged ownership without deleting sentinels',async t=>{
 const f=await fixture(t),slug='rbxport-playlist-sync',target=join(f.root,'target'),linked=join(f.root,'linked');await mkdir(target);await writeFile(join(target,'sentinel'),'keep');await symlink(target,linked,process.platform==='win32'?'junction':'dir');
 await assert.rejects(installJavaScriptPayload(payload(slug),{...f.options,directory:linked}),/Linked/);assert.equal(await readFile(join(target,'sentinel'),'utf8'),'keep');
 await installJavaScriptPayload(payload(slug),f.options);const path=join(f.local,'Programs',slug,'installed.json'),record=await json(path);record.files.push({path:'song.mp3',sha256:'0'.repeat(64)});await writeFile(path,JSON.stringify(record));await assert.rejects(installJavaScriptPayload(payload(slug),f.options),/unowned/);
});
test('one-file setup builds reproducibly, verifies and shows help without installing',async t=>{
 const root=await mkdtemp(join(tmpdir(),'rbxport-js-bundle-'));t.after(()=>rm(root,{recursive:true,force:true}));const a=await buildJavaScriptInstaller({destination:join(root,'one.mjs')}),b=await buildJavaScriptInstaller({destination:join(root,'two.mjs')});assert.equal(a.sha256,b.sha256);assert(a.bytes<4*1024*1024);
 if(process.platform==='win32')await writeFile(a.destination+':Zone.Identifier','[ZoneTransfer]\r\nZoneId=3\r\n');
 const {stdout}=await promisify(execFile)(process.execPath,[a.destination,'--verify'],{cwd:root});const result=JSON.parse(stdout);assert.equal(result.verified,true);assert.equal(result.requiresNode,'>=24');assert.equal(result.files,a.files);const help=await promisify(execFile)(process.execPath,[a.destination,'--help'],{cwd:root});assert.match(help.stdout,/Requires Node\.js 24/);assert.match(help.stdout,/regular rbxport/);
 const isolated=await import(pathToFileURL(a.destination));assert.equal(isolated.setupPayload.files.length,a.files);const f=await fixture(t),slug=isolated.setupPayload.product;const installed=await isolated.installJavaScriptPayload(payload(slug),f.options);assert.equal(installed.shortcuts,2);
 const encoded=encodeInstallerPayload(payload('rbxport-playlist-sync'));assert.equal(decodeInstallerPayload(encoded.content,encoded.sha256).product,'rbxport-playlist-sync');assert.throws(()=>decodeInstallerPayload(encoded.content,'0'.repeat(64)),/damaged/);
});
// Minimal regular ZIP: two named tools, never executed.
function toolZIP(){
 const chunks=[],central=[];let offset=0;function crc(b){let c=0xffffffff;for(const x of b){c^=x;for(let n=0;n<8;n++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
 for(const name of ['fixture/bin/ffmpeg.exe','fixture/bin/ffprobe.exe']){const n=bytes(name),h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt32LE(crc(toolBytes),14);h.writeUInt32LE(toolBytes.length,18);h.writeUInt32LE(toolBytes.length,22);h.writeUInt16LE(n.length,26);chunks.push(h,n,toolBytes);const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt32LE(crc(toolBytes),16);c.writeUInt32LE(toolBytes.length,20);c.writeUInt32LE(toolBytes.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);central.push(c,n);offset+=h.length+n.length+toolBytes.length;}
 const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(2,8);end.writeUInt16LE(2,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...chunks,directory,end]);
}
test('Windows setup exercises native signatures, ZIP extraction and shortcuts in isolated folders',{skip:process.platform!=='win32'},async t=>{
 const f=await fixture(t),pkg=await json(new URL('../package.json',import.meta.url)),slug=pkg.name.replace(/-addon$/,''),node=await readFile(process.execPath),archive=toolZIP();await writeFile(join(f.cache,'node.exe'),node);await writeFile(join(f.cache,'ffmpeg-essentials.zip'),archive);
 const source=fileURLToPath(new URL('../',import.meta.url)),id=installerProducts[slug].id,extra=[];
 for(const path of ['scripts/Startup.ps1','scripts/HostShortcuts.ps1'])extra.push([path,await readFile(join(source,path),'utf8')]);extra.push([`Start-${id}.ps1`,'# synthetic launcher, never executed']);
 const ops=createWindowsOps({fixtureRoot:f.root}),result=await installJavaScriptPayload(payload(slug,{node,archive,extra}),{...f.options,ops});assert.equal(result.shortcuts,2);
 const links=await ops.call(slug,'links',{paths:[join(f.root,'Desktop/rbxport.lnk'),join(f.root,'Programs/rbxport.lnk')]});assert.equal(links.length,2);for(const l of links){assert.equal(l.properties.target,join(f.local,'rbxport-addons/runtime',hash(node),'node.exe'));assert.equal(l.properties.windowStyle,7);assert.equal(l.properties.icon,join(f.root,'rbxport.exe')+',0');}
 assert.equal((await json(join(f.local,'rbxport-addons/startup.json'))).addons[0].root,result.root);assert.equal(await present(join(f.root,slug+'-registry.json')),true);
 await mkdir(result.dataDirectory,{recursive:true});await writeFile(join(result.dataDirectory,'saved.sqlite'),'saved-data sentinel');await writeFile(join(result.root,'song.mp3'),'music sentinel');
 const removal=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('./javascript-installer-removal.ps1',import.meta.url)),'-Root',result.root,'-Source',source,'-Fixture',f.root],{timeout:30000});assert.match(removal.stdout,/compatible with managed removal/);
 assert.equal(await readFile(join(result.dataDirectory,'saved.sqlite'),'utf8'),'saved-data sentinel');assert.equal(await readFile(join(result.root,'song.mp3'),'utf8'),'music sentinel');assert.equal(await present(join(f.root,'Desktop/rbxport.lnk')),false);
});
