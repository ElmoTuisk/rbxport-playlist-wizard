// Shared Node.js entry point. No host database access, native compilation or policy changes.
import { spawn, execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile, mkdir, open, unlink, lstat, link } from 'node:fs/promises';
import { dirname, join, resolve, isAbsolute, parse } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const execute = promisify(execFile);
const products = {
  'Playlist-Sync': { name: 'rbxport-playlist-sync-addon', port: 43821, model: '/api/state' },
  'Playlist-Wizard': { name: 'rbxport-playlist-wizard-addon', port: 43823, model: '/api/panel' }
};
const alive = pid => {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
};
const samePath = (a, b) => resolve(a).toLowerCase() === resolve(b).toLowerCase();
const closed = () => Object.assign(Error('rbxport closed during startup.'), { code: 'HOST_CLOSED' });
async function json(path) { return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, '')); }
export async function plainPath(path) {
  if (typeof path !== 'string' || !isAbsolute(path) || /["\r\n\0]/.test(path)) throw Error('Invalid installation path.');
  for (let current = resolve(path); ; current = dirname(current)) {
    try { if ((await lstat(current)).isSymbolicLink()) throw Error('Linked installation paths are not supported.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (current === parse(current).root) break;
  }
  return resolve(path);
}
async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
export async function inspectHosts() {
  // Fixed read-only Windows inventory command; no script files, code interpolation or execution-policy override.
  const command = "@(Get-Process -Name rbxport -ErrorAction SilentlyContinue | Select-Object Id,Path) | ConvertTo-Json -Compress";
  const { stdout } = await execute(join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 5000, maxBuffer: 65536 });
  const value = stdout.trim() ? JSON.parse(stdout) : [];
  return (Array.isArray(value) ? value : [value]).map(p => ({ pid: p.Id, path: p.Path }));
}
async function request(port, path, token, body, signal) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(2500)]),
    headers: token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : {},
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {})
  });
  if (!response.ok) throw Error('The local add-on did not accept the startup request.');
  const text = await response.text();
  if (text.length > 8 * 1024 * 1024) throw Error('Unexpected local add-on response.');
  return JSON.parse(text);
}
async function listening(port, signal) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, { redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(500)]) });
    await response.body?.cancel(); return true;
  } catch (error) { if (signal.aborted) throw signal.reason; if (error.cause?.code === 'ECONNREFUSED') return false; throw Error('Could not inspect the local add-on port.'); }
}
async function acquireLock(root, { isAlive = alive, sleep = delay, waitMs = 5000 } = {}) {
  const path = join(root, 'launch.lock'), owner = { pid: process.pid, nonce: randomUUID() }, deadline = Date.now() + waitMs;
  // Publish a completely written owner record atomically, including if this process crashes.
  const candidate = join(root, `launch-${owner.nonce}.tmp`);
  await writeFile(candidate, JSON.stringify(owner), { flag: 'wx', mode: 0o600 });
  try {
  while (true) {
    try {
      await link(candidate, path);
      return async () => { const saved = await json(path).catch(() => null); if (saved?.nonce === owner.nonce) await unlink(path); };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const saved = await json(path).catch(() => null);
      if (saved && Number.isSafeInteger(saved.pid) && saved.pid > 0 && !isAlive(saved.pid)) {
        // Only discard the exact abandoned record we inspected.
        const current = await json(path).catch(() => null);
        if (current?.nonce === saved.nonce && current?.pid === saved.pid) await unlink(path).catch(e => { if (e.code !== 'ENOENT') throw e; });
        continue;
      }
      if (Date.now() >= deadline) throw Error('Another rbxport launch is still finishing.');
      await sleep(100);
    }
  }
  } finally { await unlink(candidate); }
}
export async function loadAddon(registration) {
  const product = products[registration?.id];
  if (!product) throw Error('Unknown add-on registration.');
  const root = await plainPath(registration.root), pkg = await json(join(root, 'package.json'));
  if (pkg.name !== product.name) throw Error('The registered add-on is missing or changed.');
  const node = await plainPath(join(root, '.runtime/node.exe')), entry = await plainPath(join(root, 'src/server.mjs'));
  if (!(await lstat(node)).isFile() || !(await lstat(entry)).isFile()) throw Error('Required add-on program files are missing.');
  const manifest = await json(join(root, 'dependencies.json'));
  if (!/^https:\/\/nodejs\.org\/dist\//.test(manifest.node?.url || '') || !/^[a-f0-9]{64}$/.test(manifest.node?.sha256 || '') || await sha256(node) !== manifest.node.sha256) throw Error('The private Node.js runtime failed checksum verification. Run setup again.');
  const installed = await json(join(root, 'installed.json')).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (installed?.installDirectory && !samePath(installed.installDirectory, root)) throw Error('The installed add-on record belongs to another folder.');
  const data = await plainPath(installed?.dataDirectory ?? join(root, '.local-data'));
  return { ...product, id: registration.id, root, node, entry, data };
}
async function attachAddon(addon, host, { signal, pauseAutomatic, isAlive, sleep, http = request, isListening = listening, spawnProcess = spawn, readyMs = 45000 }) {
  const deadline = Date.now() + readyMs;
  const check = () => { signal.throwIfAborted(); if (!isAlive(host.pid)) throw closed(); };
  const wait = async () => { check(); if (Date.now() >= deadline) throw Error('The sidebar did not become ready. See this add-on’s private service log.'); await sleep(150, undefined, { signal }); };
  const pairedModel = async () => {
    const url = (await readFile(join(addon.data, 'launch-url.txt'), 'utf8')).trim();
    const prefix = `http://127.0.0.1:${addon.port}/#`;
    if (!url.startsWith(prefix) || !/^[a-f0-9]{64}$/.test(url.slice(prefix.length))) throw Error('Invalid local pairing information.');
    const token = url.slice(prefix.length);
    return { token, model: await http(addon.port, addon.model, token, undefined, signal) };
  };
  let paired;
  while (await isListening(addon.port, signal)) {
    check();
    try { paired = await pairedModel(); }
    catch { throw Error('Another or unrecognized add-on instance occupies its local port. Stop that instance before retrying.'); }
    if (paired.model.hostPid === host.pid) break;
    if (!Number.isSafeInteger(paired.model.hostPid) || isAlive(paired.model.hostPid)) throw Error('The add-on belongs to a different host session.');
    paired = null; await wait(); // Allow the exact previous session to finish gracefully.
  }
  let child;
  if (!paired) {
    check(); await mkdir(addon.data, { recursive: true });
    const output = await open(join(addon.data, 'service.log'), 'a', 0o600), errors = await open(join(addon.data, 'service-error.log'), 'a', 0o600);
    try {
      const args = [addon.entry, '--data-dir', addon.data, '--host-pid', String(host.pid)];
      if (pauseAutomatic && addon.id === 'Playlist-Sync') args.push('--pause-automatic');
      const env = { ...process.env }; delete env.NODE_OPTIONS; delete env.NODE_PATH;
      child = spawnProcess(addon.node, args, { cwd: addon.root, detached: true, windowsHide: true, shell: false, env, stdio: ['ignore', output.fd, errors.fd] });
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', () => reject(Error('Windows could not start the private Node.js runtime.'))); });
      await writeFile(join(addon.data, 'service.pid'), String(child.pid), { mode: 0o600 }); child.unref();
    } finally { await output.close(); await errors.close(); }
  }
  while (true) {
    check();
    if (child && child.exitCode !== null) throw Error('The add-on service stopped before its sidebar was ready. See its private service log.');
    try {
      paired = await pairedModel();
      if (paired.model.hostPid !== host.pid) throw Error('The add-on belongs to a different host session.');
      const result = await http(addon.port, '/api/action', paired.token, { action: 'connect', args: {} }, signal);
      if (result.ready === true) return { id: addon.id, libraryReady: result.libraryReady !== false };
    } catch (error) { if (signal.aborted) throw signal.reason; if (/different host session/.test(error.message)) throw error; }
    await wait();
  }
}
export async function launchSession(directory, options = {}) {
  const { hosts = inspectHosts, spawnProcess = spawn, isAlive = alive, sleep = delay, prepareAddon = loadAddon, attach = attachAddon, pauseAutomatic = false, pollMs = 250 } = options;
  const root = await plainPath(directory); await mkdir(root, { recursive: true });
  const release = await acquireLock(root, { isAlive, sleep, waitMs: options.lockWaitMs });
  const status = async state => writeFile(join(root, 'launch-status.txt'), `${state} ${new Date().toISOString()}\n`, { mode: 0o600 });
  let timer;
  try {
    await status('Starting');
    const state = await json(join(root, 'startup.json')), executable = await plainPath(state.hostExecutable);
    if (!(await lstat(executable)).isFile()) throw Error('The registered rbxport executable is missing.');
    if (state.version !== 2 || !Array.isArray(state.addons) || !state.addons.length || state.addons.length > 2 || new Set(state.addons.map(a => a.id)).size !== state.addons.length) throw Error('Invalid add-on startup registration.');
    // Resolve every registered product before opening a host; runtime failures remain independent.
    const addons = await Promise.allSettled(state.addons.map(prepareAddon));
    if (addons.every(a => a.status === 'rejected')) throw Error('The registered add-ons need to be repaired with setup.');
    const existing = await hosts();
    if (existing.some(p => !p.path || !samePath(p.path, executable)) || existing.length > 1) throw Error('Close the other rbxport copy before opening this shortcut.');
    let host = existing[0];
    if (!host) {
      const child = spawnProcess(executable, [], { cwd: dirname(executable), detached: true, shell: false, windowsHide: false, stdio: 'ignore', env: { ...process.env, RBXPORT_DEVTOOLS_PORT: '43822' } });
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', () => reject(Error('Windows could not open the registered rbxport executable.'))); });
      child.unref(); host = { pid: child.pid, path: executable };
    }
    if (!Number.isSafeInteger(host.pid) || host.pid <= 0) throw Error('Could not identify the exact rbxport process.');
    const controller = new AbortController();
    timer = setInterval(() => { try { if (!isAlive(host.pid)) controller.abort(closed()); } catch { /* Inspection errors do not prove exit. */ } }, pollMs);
    if (!isAlive(host.pid)) controller.abort(closed());
    const results = await Promise.allSettled(addons.map((result, i) => result.status === 'fulfilled'
      ? attach(result.value, host, { ...options, signal: controller.signal, pauseAutomatic, isAlive, sleep, spawnProcess })
      : Promise.reject(Error(`${state.addons[i].id}: Repair this add-on’s runtime with setup.`))));
    if (controller.signal.aborted) throw controller.signal.reason;
    const failures = results.flatMap((r, i) => r.status === 'rejected' ? [`${state.addons[i].id}: ${r.reason.message}`] : []);
    if (failures.length) throw Error(failures.join('\n'));
    await status('Ready'); await unlink(join(root, 'launch-error.log')).catch(e => { if (e.code !== 'ENOENT') throw e; });
    return { hostPid: host.pid, addons: results.map(r => r.value) };
  } catch (error) {
    if (error.code === 'HOST_CLOSED') { await status('Closed'); return { closed: true }; }
    // Never copy provider/HTTP response bodies, pairing URLs, tokens or child output here.
    await status('Failed'); await writeFile(join(root, 'launch-error.log'), `${error.message}\n`, { mode: 0o600 }); throw error;
  } finally { clearInterval(timer); await release(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), allowed = new Set(['--worker', '--pause-automatic', '--no-window']);
  if (args.some(a => !allowed.has(a))) { process.stderr.write('Unknown startup argument.\n'); process.exitCode = 2; }
  else if (!args.includes('--worker')) {
    // The minimized shortcut parent exits promptly. All long-running children use windowsHide.
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--worker', ...args], { cwd: dirname(fileURLToPath(import.meta.url)), detached: true, windowsHide: true, shell: false, stdio: 'ignore' });
    child.once('error', () => { process.stderr.write('Windows could not start the rbxport launcher.\n'); process.exitCode = 1; }); child.unref();
  } else {
    try { await launchSession(dirname(fileURLToPath(import.meta.url)), { pauseAutomatic: args.includes('--pause-automatic') }); }
    catch (error) {
      process.exitCode = 1;
      if (process.platform === 'win32' && !args.includes('--no-window') && error.message !== 'Another rbxport launch is still finishing.') {
        const errorFile = join(dirname(fileURLToPath(import.meta.url)), 'launch-error.log');
        // Display text with the standard Windows viewer; never execute diagnostic content.
        try {
          await lstat(errorFile);
          const viewer = spawn(join(process.env.SystemRoot, 'System32/notepad.exe'), [errorFile], { shell: false, detached: true, stdio: 'ignore' });
          viewer.on('error', () => {}); viewer.unref();
        } catch { /* The private status/error files remain available if the viewer cannot open. */ }
      }
    }
  }
}
