import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {run} from '../src/process.mjs';
test('Windows release stages public source and metadata but refuses an unsigned setup',{skip:process.platform!=='win32'},async()=>{
 const output=await run('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('./release-build.ps1',import.meta.url))],{timeout:120000});
 assert.match(output,/Release staging and unsigned publication refusal checks passed/);
});
