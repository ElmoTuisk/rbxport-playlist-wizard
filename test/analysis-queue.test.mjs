import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {mapAnalysis,analysisParallelism} from '../src/analysis-queue.mjs';

test('analysis uses at most two slots and falls back to one on smaller or memory-constrained systems',()=>{
  assert.equal(analysisParallelism({cpus:16,freeBytes:1024**3}),2);
  assert.equal(analysisParallelism({cpus:16,freeBytes:512*1024**2}),1);
  assert.equal(analysisParallelism({cpus:2,freeBytes:8*1024**3}),1);
});

test('parallel completion retains input order and never exceeds its bound',async()=>{
  let active=0,peak=0;const finished=[];
  const result=await mapAnalysis([30,5,10,2],async(ms,index)=>{
    peak=Math.max(peak,++active);await delay(ms);active--;finished.push(index);return index;
  },{concurrency:2});
  assert.equal(peak,2);assert.equal(active,0);assert.notDeepEqual(finished,[0,1,2,3]);assert.deepEqual(result,[0,1,2,3]);
  await assert.rejects(mapAnalysis([],()=>{},{concurrency:3}),/one or two/);
});

test('a fatal track error aborts and drains its sibling before returning, without starting queued tracks',async()=>{
  const failure=Object.assign(Error('Library changed'),{code:'IDENTITY'});let started=0,cleaned=false;
  await assert.rejects(mapAnalysis([0,1,2,3],async(item,index,signal)=>{
    started++;
    if(index===0){await delay(10);throw failure;}
    try{await delay(1000,null,{signal});}finally{await delay(15);cleaned=true;}
  },{concurrency:2}),error=>error===failure);
  assert.equal(started,2);assert.equal(cleaned,true);
});

test('user cancellation stops both active slots and drains them before the queue settles',async()=>{
  const controller=new AbortController();let started=0,active=0,cleaned=0;
  const pending=mapAnalysis([0,1,2,3],async(item,index,signal)=>{
    started++;active++;if(started===2)queueMicrotask(()=>controller.abort());
    try{await delay(1000,null,{signal});}finally{active--;cleaned++;}
  },{concurrency:2,signal:controller.signal});
  await assert.rejects(pending,/abort/i);assert.equal(started,2);assert.equal(active,0);assert.equal(cleaned,2);
});
