import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const args=['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('./startup.ps1',import.meta.url)),'-NodePath',process.execPath];
test('Windows JavaScript shortcuts preserve both registrations, original bytes, runtime trust and actual shortcut dispatch',{skip:process.platform!=='win32'},async()=>{
 const {stdout}=await promisify(execFile)('powershell.exe',args,{timeout:60000});
 assert.match(stdout,/Independent JavaScript add-on startup checks passed/);
});
