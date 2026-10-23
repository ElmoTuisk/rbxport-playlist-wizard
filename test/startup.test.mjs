import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const args=['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('./startup.ps1',import.meta.url))];
test('Windows startup preserves companion configuration and background launch never opens the host',{skip:process.platform!=='win32'},async()=>{
 const {stdout}=await promisify(execFile)('powershell.exe',[...args,'-SkipNativeExecution'],{timeout:60000});
 assert.match(stdout,/Independent add-on startup checks passed/);
});
test('Windows native fixture reports ready, failure and close through an actual shortcut',{skip:process.platform!=='win32'},async t=>{
 try{const {stdout}=await promisify(execFile)('powershell.exe',args,{timeout:60000});assert.match(stdout,/Independent add-on startup checks passed/);}
 catch(error){if(/An Application Control policy has blocked this file/.test(error.stderr||'')){t.skip('Smart App Control blocked the unsigned synthetic EXE; real signed-release validation is still required.');return;}throw error;}
});
