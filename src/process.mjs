import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

export function run(executable, args, { signal, timeout = 120000, onLine, input, maxBytes = 16 * 1024 * 1024, collectStdout = true } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'], signal });
    let stdout = '', stderr = '', pending = '', size = 0, settled = false;
    const decoder = new StringDecoder('utf8');
    const timer = setTimeout(() => { child.kill(); finish(new Error('Tool timed out')); }, timeout);
    const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(result); };
    child.on('error', error => finish(new Error(error.name === 'AbortError' ? 'Cancelled' : `Cannot run ${executable}: ${error.message}`)));
    child.stdout.on('data', chunk => {
      if(settled)return;
      size += chunk.length;
      if (size > maxBytes) { child.kill(); finish(new Error('Tool response exceeded size limit')); return; }
      const text = decoder.write(chunk);
      if(collectStdout)stdout += text;
      if(onLine)try {
        pending += text;
        const lines = pending.split(/\r?\n/); pending = lines.pop(); lines.forEach(line => onLine(line));
      }catch(error){child.kill();finish(error);}
    });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8192); });
    child.on('close', code => {
      if(settled)return;
      const tail=decoder.end();if(collectStdout)stdout+=tail;pending+=tail;
      try { if(pending)onLine?.(pending); }
      catch(error){finish(error);return;}
      finish(code === 0 ? null : new Error(`Tool exited ${code}: ${stderr.replace(/(token|authorization|cookie)[=: ]+\S+/gi, '$1=[redacted]').slice(-1500)}`), stdout);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input || '');
  });
}
