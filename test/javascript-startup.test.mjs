import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { launchSession, loadAddon } from '../scripts/Start-Rbxport.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'rbxport-js-startup-'));
  const host = join(root, 'host.exe'); await writeFile(host, 'synthetic; never executed');
  const children = [];
  t.after(async () => { for (const c of children) if (c.exitCode === null) c.kill(); await delay(100); await rm(root, { recursive: true, force: true }); });
  const state = { version: 2, hostExecutable: host, addons: [{ id: 'Playlist-Sync', root: join(root, 'sync') }, { id: 'Playlist-Wizard', root: join(root, 'wizard') }] };
  await writeFile(join(root, 'startup.json'), JSON.stringify(state));
  return { root, host, state, children };
}
const pidAlive = pid => { try { process.kill(pid, 0); return true; } catch (e) { if (e.code === 'ESRCH') return false; throw e; } };
const prepare = async a => a;

test('JavaScript startup starts both companions concurrently, reuses one exact host, and releases its lock', async t => {
  const f = await fixture(t); let starts = 0, host = null, dispatch = [];
  let wizard; const started = new Promise(r => { wizard = r; });
  const options = { hosts: async () => host ? [host] : [], prepareAddon: prepare, isAlive: () => true,
    spawnProcess: (exe, args, options) => {
      assert.equal(exe, f.host); assert.deepEqual(args, []); assert.equal(options.shell, false); assert.equal(options.env.RBXPORT_DEVTOOLS_PORT, '43822'); starts++;
      const c = new EventEmitter(); c.pid = 43210; c.unref = () => {}; host = { pid: c.pid, path: exe }; queueMicrotask(() => c.emit('spawn')); return c;
    }, attach: async (addon, actual, options) => { assert.equal(actual.pid, 43210); assert.equal(options.pauseAutomatic, true); dispatch.push(addon.id); if (addon.id === 'Playlist-Sync') await started; else wizard(); return { id: addon.id }; }, pauseAutomatic: true };
  await launchSession(f.root, options); await launchSession(f.root, options);
  assert.equal(starts, 1); assert.equal(dispatch.length, 4); assert.match(await readFile(join(f.root, 'launch-status.txt'), 'utf8'), /^Ready /);
  await assert.rejects(access(join(f.root, 'launch.lock')));
});
test('a failed companion does not prevent the other from starting or expose pairing data', async t => {
  const f = await fixture(t); const dispatched = [];
  await assert.rejects(launchSession(f.root, { hosts: async () => [{ pid: 1, path: f.host }], isAlive: () => true, prepareAddon: prepare,
    attach: async a => { dispatched.push(a.id); if (a.id === 'Playlist-Sync') throw Error('Synthetic failure.'); return { id: a.id }; }
  }), /Playlist-Sync: Synthetic failure/);
  assert.deepEqual(dispatched, ['Playlist-Sync', 'Playlist-Wizard']); assert.match(await readFile(join(f.root, 'launch-status.txt'), 'utf8'), /^Failed /);
});
test('closing during readiness cancels both pending companions, permits immediate reopen, and never relaunches later', async t => {
  const f = await fixture(t); let running = true, started = 0;
  const pending = launchSession(f.root, { hosts: async () => [{ pid: 1, path: f.host }], isAlive: () => running, pollMs: 10, prepareAddon: prepare,
    attach: async (a, h, { signal }) => { started++; await delay(30000, undefined, { signal }); } });
  while (started < 2) await delay(5); running = false;
  assert.deepEqual(await pending, { closed: true }); assert.match(await readFile(join(f.root, 'launch-status.txt'), 'utf8'), /^Closed /);
  running = true;
  await launchSession(f.root, { hosts: async () => [{ pid: 2, path: f.host }], isAlive: () => running, prepareAddon: prepare, attach: async a => ({ id: a.id }) });
  assert.match(await readFile(join(f.root, 'launch-status.txt'), 'utf8'), /^Ready /);
});
test('startup refuses another host path, duplicate registrations and a busy owner, and recovers an abandoned owner', async t => {
  const f = await fixture(t), defaults = { hosts: async () => [{ pid: 1, path: f.host }], isAlive: p => p !== 99999, prepareAddon: prepare, attach: async a => a };
  await assert.rejects(launchSession(f.root, { ...defaults, hosts: async () => [{ pid: 1, path: join(f.root, 'other.exe') }] }), /other rbxport copy/);
  const lock = join(f.root, 'launch.lock'); await writeFile(lock, JSON.stringify({ pid: process.pid, nonce: 'busy' }));
  await assert.rejects(launchSession(f.root, { ...defaults, lockWaitMs: 0 }), /still finishing/);
  assert.equal(JSON.parse(await readFile(lock, 'utf8')).nonce, 'busy');
  await writeFile(lock, JSON.stringify({ pid: 99999, nonce: 'abandoned' })); await launchSession(f.root, defaults);
  f.state.addons.push(f.state.addons[0]); await writeFile(join(f.root, 'startup.json'), JSON.stringify(f.state));
  await assert.rejects(launchSession(f.root, defaults), /Invalid add-on startup registration/);
});
test('installed add-on loading verifies package, runtime checksum and original saved-data path', async t => {
  const f = await fixture(t), root = join(f.root, 'addon'), data = join(f.root, 'saved');
  await mkdir(join(root, '.runtime'), { recursive: true }); await mkdir(join(root, 'src')); await writeFile(join(root, 'src/server.mjs'), '// fixture');
  await writeFile(join(root, '.runtime/node.exe'), 'synthetic; never executed');
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'rbxport-playlist-sync-addon' }));
  await writeFile(join(root, 'dependencies.json'), JSON.stringify({ node: { url: 'https://nodejs.org/dist/fixture', sha256: createHash('sha256').update('synthetic; never executed').digest('hex') } }));
  await writeFile(join(root, 'installed.json'), JSON.stringify({ installDirectory: root, dataDirectory: data }));
  const addon = await loadAddon({ id: 'Playlist-Sync', root }); assert.equal(addon.data, data); assert.equal(addon.port, 43821);
  await writeFile(join(root, '.runtime/node.exe'), 'tampered'); await assert.rejects(loadAddon({ id: 'Playlist-Sync', root }), /checksum/);
  await assert.rejects(loadAddon({ id: 'unknown', root }), /Unknown add-on/);
});
async function unusedPort() { const server = createServer(); await new Promise(r => server.listen(0, '127.0.0.1', r)); const port = server.address().port; await new Promise(r => server.close(r)); return port; }
for (const ids of [['Playlist-Sync'], ['Playlist-Wizard'], ['Playlist-Sync', 'Playlist-Wizard']]) {
test(`real synthetic services (${ids.join(' + ')}) authenticate readiness, reuse on repeated clicks, and exit with their exact host`, async t => {
  const f = await fixture(t);
  f.state.addons = f.state.addons.filter(a => ids.includes(a.id));
  await writeFile(join(f.root, 'startup.json'), JSON.stringify(f.state));
  const host = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { windowsHide: true, stdio: 'ignore' }); f.children.push(host);
  await new Promise((r, j) => { host.once('spawn', r); host.once('error', j); });
  const addons = [];
  for (const [i, registration] of f.state.addons.entries()) {
    const data = join(registration.root, 'saved'); await mkdir(data, { recursive: true }); const port = await unusedPort(), entry = join(registration.root, 'server.mjs');
    // No host library or external provider: this child only implements a paired loopback fixture.
    await writeFile(entry, `import {createServer} from 'node:http';import {writeFileSync} from 'node:fs';const token='${String(i + 1).repeat(64)}';const args=process.argv;const pid=Number(args[args.indexOf('--host-pid')+1]);const server=createServer((q,r)=>{r.setHeader('Content-Type','application/json');if(q.url!=='/'&&q.headers.authorization!=='Bearer '+token){r.writeHead(401);r.end('{}');return;}if(q.url==='/api/action'){r.end(JSON.stringify({ready:true,libraryReady:${i === 0 ? 'false' : 'true'}}));}else r.end(JSON.stringify({hostPid:pid}));});server.listen(${port},'127.0.0.1',()=>writeFileSync(${JSON.stringify(join(data, 'launch-url.txt'))},'http://127.0.0.1:${port}/#'+token));const timer=setInterval(()=>{try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH'){clearInterval(timer);server.closeAllConnections();server.close();}}},25);`);
    addons.push({ ...registration, data, node: process.execPath, entry, port, model: i ? '/api/panel' : '/api/state' });
  }
  let serviceStarts = 0;
  const options = { hosts: async () => [{ pid: host.pid, path: f.host }], prepareAddon: a => addons.find(b => b.id === a.id), isAlive: pidAlive, pollMs: 25, readyMs: 5000,
    spawnProcess: (...args) => { serviceStarts++; const c = spawn(...args); f.children.push(c); return c; } };
  const first = await launchSession(f.root, options); assert.equal(first.hostPid, host.pid); assert.equal(first.addons[0].libraryReady, false);
  assert.deepEqual(first.addons.map(a => a.id), ids);
  await launchSession(f.root, options); assert.equal(serviceStarts, ids.length);
  host.kill(); await new Promise(r => host.once('exit', r));
  for (let i = 0; i < 100 && f.children.some(c => c.exitCode === null && c.signalCode === null); i++) await delay(25);
  assert(f.children.every(c => c.exitCode !== null || c.signalCode !== null));
  const status = await readFile(join(f.root, 'launch-status.txt'), 'utf8'); assert(!/[1-2]{64}/.test(status));
});
}
