import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { Installation } from '../src/installation.mjs';
import { run } from '../src/process.mjs';

test('uninstall is available only for a matching managed installation and launches a fixed helper',async t=>{
 // Windows CI may expose its temporary directory through a short path or junction.
 // The fixture represents a real installed folder, which must use its canonical path.
 const root=await realpath(await mkdtemp(join(tmpdir(),'sync-installation-')));t.after(()=>rm(root,{recursive:true,force:true}));
 const calls=[];const launch=(...args)=>{calls.push(args);const child=new EventEmitter();child.unref=()=>{};queueMicrotask(()=>child.emit('spawn'));return child;};
 const installation=new Installation({root,platform:'win32',launch});
 assert.equal((await installation.status()).canUninstall,false);await assert.rejects(installation.uninstall(),/single-file setup/);
 await writeFile(join(root,'Uninstall-Playlist-Wizard.ps1'),'# fixture');
 const receipt={schema:1,product:'rbxport-playlist-wizard',installDirectory:root,version:'0.10.5'};
 await writeFile(join(root,'installed.json'),'\uFEFF'+JSON.stringify(receipt));
 assert.equal((await installation.status()).canUninstall,true);await installation.uninstall();
 assert.equal(calls.length,1);assert(calls[0][1].includes(join(root,'Uninstall-Playlist-Wizard.ps1')));assert(calls[0][1].includes('-Confirmed'));assert(calls[0][1].includes(String(process.pid)));assert.equal(calls[0][2].windowsHide,true);
 await writeFile(join(root,'installed.json'),JSON.stringify({...receipt,installDirectory:join(root,'other')}));
 assert.equal((await installation.status()).canUninstall,false);await assert.rejects(installation.uninstall());assert.equal(calls.length,1);
});

test('Windows managed install, update and uninstall preserve music, edited files and saved data', {skip:process.platform!=='win32'},async()=>{
 const output=await run('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('./installation.ps1',import.meta.url)),'-NodePath',process.execPath],{timeout:120000});
 assert.match(output,/Managed installation checks passed/);
});
