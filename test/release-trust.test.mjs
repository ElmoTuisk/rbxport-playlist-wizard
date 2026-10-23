import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {run} from '../src/process.mjs';
test('Windows release trust rejects unsigned, tampered and unexpected publisher artifacts',{skip:process.platform!=='win32'},async()=>{
  const output=await run('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('./release-trust.ps1',import.meta.url))],{timeout:30000});
  assert.match(output,/Release trust checks passed/);
});
test('production shortcut setup has no compiler or unsigned fallback',async()=>{
  const source=await readFile(new URL('../scripts/HostShortcuts.ps1',import.meta.url),'utf8');
  assert.doesNotMatch(source,/csc\.exe|launcher-build\.json|conhost\.exe/i);
  assert(source.indexOf('Assert-RbxportReleaseTrust')<source.indexOf('Copy-Item -LiteralPath $source'));
});
