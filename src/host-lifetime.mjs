// A launched desktop session owns the service. A WebView reload is not a host exit.
export function watchHostProcess(pid, onExit, {alive = id => { try { process.kill(id, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } }, interval = 1000} = {}) {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw Error('Invalid rbxport process ID');
  let stopped = false;
  const stop = () => { stopped = true; clearInterval(timer); };
  const check = () => {
    if (stopped) return;
    try { if (alive(pid)) return; } catch { return; } // An inspection error is not proof of exit.
    stop(); onExit();
  };
  const timer = setInterval(check, interval); timer.unref();
  queueMicrotask(check);
  return stop;
}
