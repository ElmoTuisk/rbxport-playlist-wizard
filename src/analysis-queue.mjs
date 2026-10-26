import {availableParallelism,freemem} from 'node:os';

// Keep room for rbxport and the OS; never run a worker per logical CPU.
export function analysisParallelism({cpus=availableParallelism(),freeBytes=freemem()}={}) {
  return cpus>=4&&freeBytes>=768*1024*1024?2:1;
}

export async function mapAnalysis(items,analyze,{signal,concurrency=analysisParallelism()}={}) {
  if(!Number.isInteger(concurrency)||concurrency<1||concurrency>2)throw Error('Analysis concurrency must be one or two');
  signal?.throwIfAborted();
  const controller=new AbortController(),results=new Array(items.length);
  const abort=()=>controller.abort(signal.reason);
  signal?.addEventListener('abort',abort,{once:true});
  let next=0,failure;
  const work=async()=>{
    while(!controller.signal.aborted&&next<items.length) {
      const index=next++;
      try {results[index]=await analyze(items[index],index,controller.signal);}
      catch(error){if(!failure)failure=error;controller.abort(error);}
    }
  };
  try {
    await Promise.all(Array.from({length:Math.min(concurrency,items.length)},work));
    if(failure)throw failure;
    signal?.throwIfAborted();
    return results;
  } finally {signal?.removeEventListener('abort',abort);}
}
