import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { watchHostProcess } from '../src/host-lifetime.mjs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('host lifetime ends once on process exit, while inspection failures keep the session alive',async()=>{
  let alive=true, failure=false, exits=0;
  const stop=watchHostProcess(42,()=>exits++,{alive:pid=>{assert.equal(pid,42);if(failure)throw Error('temporarily unavailable');return alive;},interval:5});
  try {
    await sleep(15);assert.equal(exits,0);
    failure=true;alive=false;await sleep(15);assert.equal(exits,0);
    failure=false;await sleep(25);assert.equal(exits,1);
    alive=true;await sleep(15);assert.equal(exits,1);
  } finally {stop();}
  assert.throws(()=>watchHostProcess(0,()=>{}),/Invalid/);
});

test('disposing a host watcher prevents callbacks after service shutdown',async()=>{
  let exits=0;
  const stop=watchHostProcess(42,()=>exits++,{alive:()=>false,interval:5});stop();
  await sleep(15);assert.equal(exits,0);
});

test('a real synthetic process owns its watcher until that process exits',async()=>{
  const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});
  await once(child,'spawn');
  let exits=0;
  const stop=watchHostProcess(child.pid,()=>exits++,{interval:10});
  try {
    await sleep(40);assert.equal(exits,0);
    const exited=once(child,'exit');child.kill();await exited;
    for(let attempt=0;attempt<100&&!exits;attempt++)await sleep(10);
    assert.equal(exits,1);
  } finally {stop();if(child.exitCode===null&&child.signalCode===null)child.kill();}
});
