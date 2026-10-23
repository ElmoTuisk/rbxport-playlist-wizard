import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {run} from '../src/process.mjs';
test('Windows setup finishes despite inherited pipes and its close button cancels cooperatively',{skip:process.platform!=='win32'},async()=>{
 const result=await run('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('./setup.ps1',import.meta.url)),'-NodePath',process.execPath],{timeout:40000});
 assert.match(result,/Installer completion and cancellation checks passed/);
});
