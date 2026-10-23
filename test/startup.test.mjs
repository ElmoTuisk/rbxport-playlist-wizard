import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
test('Windows startup preserves companion configuration and background launch never opens the host', {skip:process.platform!=='win32'}, async()=>{
  const {stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('./startup.ps1',import.meta.url))],{timeout:60000});
  assert.match(stdout,/Independent add-on startup checks passed/);
});
