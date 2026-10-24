// JavaScript setup engine. It never launches rbxport or performs music operations.
import { readFile, writeFile, mkdir, copyFile, rename, unlink, rmdir, rm, lstat, realpath, readdir, mkdtemp } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join, dirname, resolve, isAbsolute, relative, parse } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Transform, Readable } from 'node:stream';
import { createInterface } from 'node:readline/promises';
import { createConnection } from 'node:net';
import { setTimeout as installerDelay } from 'node:timers/promises';
import { createWindowsOps } from './Installer-Windows.mjs';

export const installerProducts = {
  'rbxport-playlist-sync': { id: 'Playlist-Sync', title: 'Playlist Sync', port: 43821 },
  'rbxport-playlist-wizard': { id: 'Playlist-Wizard', title: 'Playlist Wizard', port: 43823 }
};
const digest = data => createHash('sha256').update(data).digest('hex');
const same = (a, b) => resolve(a).toLowerCase() === resolve(b).toLowerCase();
const exists = async path => { try { await lstat(path); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
const readJSON = async path => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
async function optionalJSON(path) { try { return await readJSON(path); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
async function fileHash(path) { const h = createHash('sha256'); for await (const b of createReadStream(path)) h.update(b); return h.digest('hex'); }
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export async function installerPath(path) {
  if (typeof path !== 'string' || !isAbsolute(path) || /["\r\n\0]/.test(path)) throw Error('Setup needs an absolute, ordinary folder path.');
  const full = resolve(path);
  for (let p = full; ; p = dirname(p)) {
    try {
      if ((await lstat(p)).isSymbolicLink()) throw Error('Linked setup paths are not supported.');
      if (!same(await realpath(p), p)) throw Error('Windows redirected this setup folder. Run setup from a normal Windows terminal.');
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (p === parse(p).root) break;
  }
  return full;
}
export function ownedInstallerFile(name, product, { retired = false } = {}) {
  const id = installerProducts[product]?.id;
  if (!id || typeof name !== 'string' || /[:\0\r\n]/.test(name)) throw Error('Invalid program ownership record.');
  const path = name.replaceAll('\\', '/');
  if (path.startsWith('/') || path.split('/').some(p => !p || p === '.' || p === '..')) throw Error('Program path escaped its installation.');
  if (path.split('/').some((p, i) => p.startsWith('.') && !(i === 0 && p === '.runtime')) || /(?:^|\/)(?:LOCAL_WORKSPACE\.md|launch-url\.txt|installed\.json|service\.pid|cookies[^/]*)$/i.test(path)) throw Error('Private setup input was refused.');
  const ordinary = /^(?:(?:src|public|scripts|docs)\/(?!.*(?:^|\/)\.[^/])[^\0]+\.(?:mjs|js|html|css|ps1|md|json|png|svg|jpg|jpeg|txt)|(?:README|PROJECT_OVERVIEW|AGENTS|CHANGELOG|THIRD_PARTY|CONTRIBUTING)\.md|LICENSE(?:-AGPL-3\.0\.txt)?|(?:package|manifest|dependencies|release-signing)\.json)$/;
  const rootScript = new RegExp(`^(?:(?:Start|Stop|Uninstall|Install)-${id}|Configure-Rbxport-Startup|Package-Addon)\\.ps1$|^(?:Launch|Install)-${id}\\.cmd$`);
  const runtime = /^\.runtime\/(?:node\.exe|tools\/(?:yt-dlp|ffmpeg|ffprobe)\.exe|essentia\/(?:essentia-(?:wasm|core)\.cjs|LICENSE-Essentia\.txt))$/;
  if (!ordinary.test(path) && !rootScript.test(path) && !runtime.test(path) && !(retired && /^(?:release\/Start-Rbxport\.exe|scripts\/RbxportLauncher\.cs)$/.test(path))) throw Error('Saved data or an unowned program path was refused.');
  return path;
}
export function validateInstallerPayload(payload) {
  if (payload?.schema !== 1 || !installerProducts[payload.product] || !/^\d+\.\d+\.\d+$/.test(payload.version) || !Array.isArray(payload.files) || payload.files.length > 1500) throw Error('Invalid JavaScript setup payload.');
  const seen = new Set(); let total = 0;
  for (const f of payload.files) {
    const name = ownedInstallerFile(f.path, payload.product);
    if (name.startsWith('.runtime/') || seen.has(name.toLowerCase()) || !validHash(f.sha256) || typeof f.content !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(f.content)) throw Error('Unexpected or duplicate setup file.');
    const bytes = Buffer.from(f.content, 'base64'); total += bytes.length;
    if (total > 48 * 1024 * 1024 || digest(bytes) !== f.sha256) throw Error('Setup file checksum/size validation failed.');
    seen.add(name.toLowerCase());
  }
  for (const required of ['package.json', 'dependencies.json', 'src/server.mjs', 'scripts/Start-Rbxport.mjs', `Uninstall-${installerProducts[payload.product].id}.ps1`]) if (!seen.has(required.toLowerCase())) throw Error('JavaScript setup is incomplete.');
  const parseFile = name => JSON.parse(Buffer.from(payload.files.find(f => f.path === name).content, 'base64').toString('utf8').replace(/^\uFEFF/, ''));
  const pkg = parseFile('package.json');
  if (pkg.name !== `${payload.product}-addon` || pkg.version !== payload.version) throw Error('Setup product/version does not match its files.');
  const deps = parseFile('dependencies.json');
  for (const [key, hosts] of Object.entries({ node: ['nodejs.org'], ffmpeg: ['www.gyan.dev'], ...(payload.product.endsWith('-sync') ? { ytdlp: ['github.com'] } : { essentia: ['registry.npmjs.org'] }) })) {
    const d = deps[key]; let url; try { url = new URL(d?.url); } catch { throw Error('Invalid dependency source.'); }
    if (url.protocol !== 'https:' || !hosts.includes(url.hostname) || url.username || url.password || !validHash(d.sha256)) throw Error('Unexpected dependency source/checksum.');
  }
  if (!validHash(deps.ffmpeg.ffmpegSha256) || !validHash(deps.ffmpeg.ffprobeSha256)) throw Error('Missing extracted-tool checksums.');
  if (deps.essentia) for (const [name, f] of Object.entries(deps.essentia.files || {})) if (!/^essentia-(wasm|core)\.cjs$|^LICENSE-Essentia\.txt$/.test(name) || !validHash(f.sha256) || typeof f.entry !== 'string') throw Error('Invalid analysis runtime manifest.');
  if (deps.essentia && Object.keys(deps.essentia.files || {}).sort().join(',') !== 'LICENSE-Essentia.txt,essentia-core.cjs,essentia-wasm.cjs') throw Error('Missing analysis runtime manifest files.');
  return { ...payload, dependencies: deps };
}
export function encodeInstallerPayload(payload) { validateInstallerPayload(payload); const bytes = gzipSync(JSON.stringify(payload), { level: 9 }); return { content: bytes.toString('base64'), sha256: digest(bytes) }; }
export function decodeInstallerPayload(content, sha256) {
  const bytes = Buffer.from(content, 'base64');
  if (bytes.length > 32 * 1024 * 1024 || digest(bytes) !== sha256) throw Error('JavaScript setup payload is damaged.');
  return validateInstallerPayload(JSON.parse(gunzipSync(bytes, { maxOutputLength: 64 * 1024 * 1024 }).toString('utf8')));
}

async function readExisting(root, payload) {
  root = await installerPath(root);
  const pkg = await optionalJSON(join(root, 'package.json'));
  if (!pkg) return null;
  if (pkg.name !== `${payload.product}-addon`) throw Error('The selected folder contains another product.');
  if (!(await exists(join(root, 'src/server.mjs'))) || await exists(join(root, '.git'))) throw Error('Select an installed copy, not an incomplete folder or Git checkout.');
  const record = await optionalJSON(join(root, 'installed.json'));
  if (record && (typeof record.dataDirectory !== 'string' || !isAbsolute(record.dataDirectory))) throw Error('The existing saved-data location is invalid.');
  if (record?.product && (record.product !== payload.product || record.schema !== 1 || !same(record.installDirectory, root))) throw Error('Installation ownership does not match its folder.');
  if (record?.product) {
    if (!Array.isArray(record.files)) throw Error('Invalid installation receipt.');
    const names = new Set();
    for (const f of record.files) { const name = ownedInstallerFile(f.path, payload.product, { retired: true }); if (names.has(name.toLowerCase()) || !validHash(f.sha256)) throw Error('Invalid installation receipt file.'); names.add(name.toLowerCase()); await installerPath(join(root, name)); }
  }
  return { root, data: await installerPath(record?.dataDirectory ?? join(root, '.local-data')), record };
}
function checkState(state) {
  if (state && (state.version !== 2 || !Array.isArray(state.addons) || state.addons.length > 2 || state.addons.some(a => !Object.values(installerProducts).some(p => p.id === a.id)) || new Set(state.addons.map(a => a.id)).size !== state.addons.length)) throw Error('The existing shared startup registration needs repair.');
}
export async function planJavaScriptInstall(payload, options, inventory) {
  const product = installerProducts[payload.product], local = await installerPath(inventory.local), shared = await installerPath(join(local, 'rbxport-addons'));
  const state = await optionalJSON(join(shared, 'startup.json')); checkState(state);
  const roots = options.directory ? [options.directory] : [inventory.registeredRoot, ...(state?.addons.filter(a => a.id === product.id).map(a => a.root) || []), join(local, 'Programs', payload.product)].filter(Boolean);
  const found = [];
  for (const root of roots) { const existing = await readExisting(root, payload); if (existing && !found.some(f => same(f.root, existing.root))) found.push(existing); }
  if (found.length > 1) throw Error('More than one installed copy was found. Specify --directory with the copy to update.');
  const root = await installerPath(found[0]?.root ?? options.directory ?? join(local, 'Programs', payload.product));
  if (!found.length && await exists(root) && (await readdir(root)).length) throw Error('The installation folder contains unrecognized files. Choose an empty folder.');
  if (options.existing && !found.length) throw Error('The selected folder is not an existing installation.');
  const data = await installerPath(found[0]?.data ?? options.dataDirectory ?? join(local, payload.product));
  if (options.dataDirectory && !same(options.dataDirectory, data)) throw Error('Updates must preserve the existing saved-data location.');
  if (inventory.userPort && inventory.userPort !== '43822') throw Error('rbxport uses a different automation port. No settings were changed.');
  if (inventory.processes.some(p => p.name?.toLowerCase() === 'rbxport.exe')) throw Error('Close rbxport normally before installing or updating.');
  let host = options.rbxportPath || state?.hostExecutable;
  if (!host || !(await exists(host))) host = inventory.hostCandidates[0];
  if (!host || !(await exists(await installerPath(host)))) throw Error('Install compatible rbxport first (tested with 1.9.0), or specify --rbxport-path.');
  const paths = [join(inventory.programs, 'rbxport.lnk'), join(inventory.desktop, 'rbxport.lnk')];
  for (const p of paths) await installerPath(p);
  for (const f of payload.files) await installerPath(join(root, f.path));
  return { root, data, shared, host, paths, old: found[0]?.record, product, inventory, state };
}

async function cachedDownload(dependency, path, { offline, fetchImpl, signal, progress }) {
  await installerPath(path);
  if (await exists(path) && await fileHash(path) === dependency.sha256) return path;
  if (offline) throw Error(`Verified offline dependency is missing: ${dependency.name}.`);
  progress(`Downloading ${dependency.name}…`);
  let url = new URL(dependency.url), response;
  const hosts = ['nodejs.org', 'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'www.gyan.dev', 'registry.npmjs.org'];
  for (let n = 0; n < 6; n++) {
    if (url.protocol !== 'https:' || !hosts.includes(url.hostname) || url.username || url.password) throw Error('Unexpected dependency redirect.');
    response = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.any([signal, AbortSignal.timeout(10 * 60 * 1000)]) });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get('location'); await response.body?.cancel(); if (!location) throw Error('Invalid dependency redirect.'); url = new URL(location, url); response = null;
  }
  if (!response?.ok || !response.body) throw Error('Dependency download failed. Retry setup after checking your connection.');
  const part = `${path}.${randomUUID()}.partial`, hash = createHash('sha256'); let size = 0;
  await mkdir(dirname(path), { recursive: true }); await installerPath(dirname(path));
  try {
    await pipeline(Readable.fromWeb(response.body), new Transform({ transform(chunk, encoding, done) { size += chunk.length; if (size > 512 * 1024 * 1024) return done(Error('Dependency exceeded its size limit.')); hash.update(chunk); done(null, chunk); } }), createWriteStream(part, { flags: 'wx', mode: 0o600 }), { signal });
    if (hash.digest('hex') !== dependency.sha256) throw Error('Dependency checksum mismatch; nothing from that download was executed.');
    await rename(part, path); return path;
  } finally { await unlink(part).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
}
function extractInstallerEssentia(bytes, manifest) {
  if (digest(bytes) !== manifest.sha256) throw Error('Analysis archive checksum mismatch.');
  const tar = gunzipSync(bytes, { maxOutputLength: 64 * 1024 * 1024 }), files = new Map();
  for (let offset = 0; offset + 512 <= tar.length;) {
    const h = tar.subarray(offset, offset + 512); if (h.every(b => !b)) break;
    const name = h.subarray(0, 100).toString('utf8').replace(/\0.*$/s, ''), sizeText = h.subarray(124, 136).toString('ascii').replace(/\0.*$/s, '').trim();
    if (!/^[0-7]+$/.test(sizeText)) throw Error('Invalid analysis archive.');
    const size = parseInt(sizeText, 8), start = offset + 512, end = start + size;
    if (!Number.isSafeInteger(size) || end > tar.length) throw Error('Truncated analysis archive.');
    for (const [target, f] of Object.entries(manifest.files)) if (name === f.entry) {
      const content = tar.subarray(start, end);
      if (files.has(target) || ![0, 48].includes(h[156]) || digest(content) !== f.sha256) throw Error('Analysis runtime file checksum/type mismatch.'); files.set(target, content);
    }
    offset = start + Math.ceil(size / 512) * 512;
  }
  if (files.size !== Object.keys(manifest.files).length) throw Error('Missing analysis runtime files.');
  return files;
}
async function lockInstaller(directory) {
  await mkdir(dirname(directory), { recursive: true }); await installerPath(dirname(directory));
  const nonce = randomUUID();
  for (let retry = 0; retry < 2; retry++) {
    try { await mkdir(directory); await installerPath(directory); await writeFile(join(directory, 'owner.json'), JSON.stringify({ pid: process.pid, nonce }), { flag: 'wx', mode: 0o600 }); break; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const owner = await optionalJSON(join(directory, 'owner.json'));
      if (!owner || !Number.isSafeInteger(owner.pid) || owner.pid < 1) throw Error('Another setup is running or its lock needs inspection.');
      let alive = true; try { process.kill(owner.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; else throw error; }
      if (alive || retry) throw Error('Another setup is running. Wait for it to finish.');
      await installerPath(directory); await unlink(join(directory, 'owner.json')); await rmdir(directory);
    }
  }
  return async () => { const owner = await optionalJSON(join(directory, 'owner.json')); if (owner?.nonce === nonce) { await unlink(join(directory, 'owner.json')); await rmdir(directory); } };
}
async function portListening(port) {
  return new Promise((resolve, reject) => { const socket = createConnection({ port, host: '127.0.0.1' }); socket.setTimeout(1000); socket.once('connect', () => { socket.destroy(); resolve(true); }); socket.once('error', e => e.code === 'ECONNREFUSED' ? resolve(false) : reject(Error('Could not inspect the local add-on port.'))); socket.once('timeout', () => { socket.destroy(); reject(Error('Local add-on port check timed out.')); }); });
}
async function stopInstalledService(plan, { fetchImpl, isListening }) {
  if (!(await isListening(plan.product.port))) return;
  let pid; try { pid = Number((await readFile(join(plan.data, 'service.pid'), 'utf8')).trim()); } catch { throw Error('An unrelated add-on occupies its port. Stop it before installing.'); }
  const entry = join(plan.root, 'src/server.mjs'), p = plan.inventory.processes.find(p => p.pid === pid);
  if (!p || p.name !== 'node.exe' || !same(p.path, join(plan.root, '.runtime/node.exe')) || !p.command?.toLowerCase().includes(`"${entry.toLowerCase()}"`)) throw Error('The running add-on does not belong to this installation.');
  const url = (await readFile(join(plan.data, 'launch-url.txt'), 'utf8')).trim(), prefix = `http://127.0.0.1:${plan.product.port}/#`;
  if (!url.startsWith(prefix) || !/^[a-f0-9]{64}$/.test(url.slice(prefix.length))) throw Error('The installed add-on cannot be paired safely.');
  const headers = { Authorization: `Bearer ${url.slice(prefix.length)}`, 'Content-Type': 'application/json' };
  const request = async (path, body) => { const r = await fetchImpl(`http://127.0.0.1:${plan.product.port}${path}`, { headers, redirect: 'error', signal: AbortSignal.timeout(5000), ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) }); if (!r.ok) throw Error('The installed add-on could not be stopped safely.'); return r.json(); };
  const model = await request('/api/panel');
  if (model.active || model.wizard?.active || model.connected) throw Error('Finish the active operation and close rbxport before updating.');
  await request('/api/shutdown', { ifIdle: true });
  for (let n = 0; n < 40; n++) { if (!(await isListening(plan.product.port))) return; await installerDelay(250); }
  throw Error('The installed add-on is still shutting down. Retry shortly.');
}

export async function installJavaScriptPayload(raw, options = {}) {
  const payload = validateInstallerPayload(raw), product = installerProducts[payload.product];
  const { ops = createWindowsOps(), fetchImpl = fetch, signal = new AbortController().signal, progress = () => {}, isListening = portListening } = options;
  const call = (action, data) => ops.call(payload.product, action, data);
  let inventory = await call('inventory'), plan = await planJavaScriptInstall(payload, options, inventory);
  if (options.confirm && !(await options.confirm(plan))) return { cancelled: true };
  signal.throwIfAborted();
  const releaseOwn = await lockInstaller(join(inventory.local, `${payload.product}-setup-lock`));
  let stage, releaseShared, result; const journal = []; let registryChanged = false;
  async function remember(path) {
    path = await installerPath(path);
    if (journal.some(e => same(e.path, path))) return;
    const entry = { path, before: null, beforeHash: 'absent', after: null };
    if (await exists(path)) { if (!(await lstat(path)).isFile()) throw Error('A program destination is not a regular file.'); entry.before = join(stage, 'backup', String(journal.length)); await mkdir(dirname(entry.before), { recursive: true }); await copyFile(path, entry.before); entry.beforeHash = await fileHash(entry.before); }
    journal.push(entry); return entry;
  }
  async function put(path, source, content) {
    const nextHash = source ? await fileHash(source) : digest(content);
    if (await exists(path) && await fileHash(path) === nextHash) return;
    const entry = await remember(path); await mkdir(dirname(path), { recursive: true }); await installerPath(dirname(path));
    const part = `${path}.${randomUUID()}.installing`;
    try { if (source) await copyFile(source, part); else await writeFile(part, content, { flag: 'wx', mode: 0o600 }); await rename(part, path); entry.after = nextHash; }
    finally { await unlink(part).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
  }
  async function removeOwned(path, expected) { if (await exists(path) && await fileHash(path) === expected) { const entry = await remember(path); await unlink(path); entry.after = 'absent'; } }
  try {
    const cache = await installerPath(options.cacheDirectory ?? join(inventory.local, `${payload.product}-setup-cache`)); await mkdir(cache, { recursive: true }); await installerPath(cache);
    stage = await mkdtemp(join(cache, 'transaction-')); await installerPath(stage);
    const downloads = new Map(), deps = payload.dependencies;
    for (const [key, name] of [['node', 'node.exe'], ['ffmpeg', 'ffmpeg-essentials.zip'], ...(deps.ytdlp ? [['ytdlp', 'yt-dlp.exe']] : []), ...(deps.essentia ? [['essentia', 'essentia.js-0.1.3.tgz']] : [])]) downloads.set(key, await cachedDownload({ ...deps[key], name }, join(cache, name), { ...options, fetchImpl, signal, progress }));
    if (!(await call('signature', { path: downloads.get('node') })).valid) throw Error('The official Node.js publisher signature could not be verified.');
    const tools = join(stage, 'tools'); await mkdir(tools); await call('ffmpeg', { archive: downloads.get('ffmpeg'), directory: tools });
    const incoming = new Map(payload.files.map(f => [f.path, { content: Buffer.from(f.content, 'base64'), sha256: f.sha256 }]));
    incoming.set('.runtime/node.exe', { source: downloads.get('node'), sha256: deps.node.sha256 });
    for (const [name, sha256] of [['ffmpeg.exe', deps.ffmpeg.ffmpegSha256], ['ffprobe.exe', deps.ffmpeg.ffprobeSha256]]) { const source = join(tools, name); if (await fileHash(source) !== sha256) throw Error('Extracted audio-tool checksum mismatch.'); incoming.set(`.runtime/tools/${name}`, { source, sha256 }); }
    if (deps.ytdlp) incoming.set('.runtime/tools/yt-dlp.exe', { source: downloads.get('ytdlp'), sha256: deps.ytdlp.sha256 });
    if (deps.essentia) for (const [name, content] of extractInstallerEssentia(await readFile(downloads.get('essentia')), deps.essentia)) incoming.set(`.runtime/essentia/${name}`, { content, sha256: digest(content) });
    for (const name of incoming.keys()) { ownedInstallerFile(name, payload.product); await installerPath(join(plan.root, name)); }
    if (same(process.execPath, join(plan.root, '.runtime/node.exe')) && await fileHash(process.execPath) !== deps.node.sha256) throw Error('Run this update with the separately installed Node.js, so its private runtime can be replaced.');
    await mkdir(plan.shared, { recursive: true }); await installerPath(plan.shared);
    releaseShared = await lockInstaller(join(plan.shared, 'javascript-setup-lock'));
    inventory = await call('inventory'); plan = await planJavaScriptInstall(payload, options, inventory);
    await stopInstalledService(plan, { fetchImpl, isListening }); signal.throwIfAborted();
    const oldState = await optionalJSON(join(plan.shared, 'startup.json')); checkState(oldState);
    for (const a of oldState?.addons || []) if (a.id !== product.id) {
      const slug = Object.keys(installerProducts).find(s => installerProducts[s].id === a.id);
      if (!(await readExisting(a.root, { product: slug }))) throw Error('The companion installation needs repair before changing shared startup.');
    }
    const links = await call('links', { paths: plan.paths }), record = await optionalJSON(join(plan.shared, 'host-shortcuts.json')) ?? await optionalJSON(join(plan.shared, 'sync-host-shortcuts.json'));
    if (record && (!Array.isArray(record.entries) || record.entries.some(e => !plan.paths.some(path => same(path, e.path)) || (e.original != null && (typeof e.original !== 'string' || e.original.length > 2 * 1024 * 1024))))) throw Error('Invalid original-shortcut restoration record.');
    const shortcutPlans = [];
    for (const l of links) {
      const old = record?.entries?.find(e => same(e.path, l.path)); let original = null;
      if (l.exists) {
        const isOwned = old && (digest(Buffer.from(l.bytes, 'base64')) === old.hash?.toLowerCase() || (old.signature && JSON.stringify(JSON.parse(old.signature)) === JSON.stringify(l.properties)));
        if (isOwned) original = old.original;
        else if (same(l.properties.target, plan.host) && !l.properties.arguments) original = l.bytes;
        else throw Error('A customized rbxport shortcut was preserved. Restore its ordinary target before installing.');
      }
      shortcutPlans.push({ path: l.path, original });
    }
    const beforeWrite = await call('inventory');
    if (beforeWrite.processes.some(p => p.name?.toLowerCase() === 'rbxport.exe') || await isListening(product.port)) throw Error('rbxport or the add-on started during setup. Close it before retrying.');
    progress(`Installing ${product.title} ${payload.version}…`);
    for (const [name, f] of incoming) { signal.throwIfAborted(); await put(join(plan.root, name), f.source, f.content); }
    const node = join(plan.shared, 'runtime', deps.node.sha256, 'node.exe'), launcher = join(plan.shared, 'Start-Rbxport.mjs');
    await put(node, downloads.get('node')); await put(launcher, null, incoming.get('scripts/Start-Rbxport.mjs').content);
    const state = { version: 2, previousPort: oldState ? oldState.previousPort : inventory.userPort, hostExecutable: plan.host, addons: [...(oldState?.addons || []).filter(a => a.id !== product.id), { id: product.id, root: plan.root }] };
    const properties = { target: node, arguments: `"${launcher}"`, workingDirectory: plan.shared, windowStyle: 7, icon: `${plan.host},0`, description: 'Open rbxport with enabled Playlist Sync and Playlist Wizard add-ons', hotkey: '' };
    for (const p of plan.paths) { await mkdir(dirname(p), { recursive: true }); await installerPath(dirname(p)); (await remember(p)).expectedProperties = properties; }
    const written = await call('write-links', { entries: plan.paths.map(path => ({ path, properties, expectedHash: links.find(l => same(l.path, path)).exists ? digest(Buffer.from(links.find(l => same(l.path, path)).bytes, 'base64')) : null })) });
    for (const l of written) {
      const entry = journal.find(e => same(e.path, l.path)); entry.after = digest(Buffer.from(l.bytes, 'base64'));
      if (JSON.stringify(l.properties) !== JSON.stringify(properties)) throw Error('The shortcut resolved outside the expected physical installation.');
      const saved = shortcutPlans.find(e => same(e.path, l.path)); saved.hash = entry.after.toUpperCase(); saved.signature = JSON.stringify(properties);
    }
    await put(join(plan.shared, 'host-shortcuts.json'), null, Buffer.from(JSON.stringify({ schema: 4, entries: shortcutPlans }, null, 2)));
    await put(join(plan.shared, 'startup.json'), null, Buffer.from(JSON.stringify(state, null, 2)));
    const conventional = [join(inventory.desktop, `${product.title}.lnk`), join(inventory.programs, product.title, `${product.title}.lnk`), join(inventory.programs, product.title, `Stop ${product.title}.lnk`), join(inventory.startup, `rbxport-${product.id}.lnk`)];
    for (const path of conventional) await installerPath(path);
    for (const l of await call('links', { paths: conventional })) {
      if (!l.exists) continue;
      const match = /^-NoProfile(?: -WindowStyle Hidden)? -ExecutionPolicy Bypass -File "([^"]+)"(?: -Background -NoWindow)?$/.exec(l.properties.arguments);
      if (same(l.properties.target, join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe')) && match && ['Start', 'Stop'].some(verb => same(match[1], join(plan.root, `${verb}-${product.id}.ps1`)))) await removeOwned(l.path, digest(Buffer.from(l.bytes, 'base64')));
    }
    // Remove only unchanged owned files, including documented pre-receipt helpers.
    const obsolete = [...(plan.old?.files || [])];
    const legacyFile = incoming.get('scripts/obsolete-program-files.json');
    if (legacyFile) {
      const legacy = JSON.parse(legacyFile.content.toString('utf8'));
      if (legacy.schema !== 1 || !legacy.files || typeof legacy.files !== 'object') throw Error('Invalid obsolete-program manifest.');
      for (const [path, hashes] of Object.entries(legacy.files)) {
        const name = ownedInstallerFile(path, payload.product, { retired: true });
        if (!Array.isArray(hashes) || hashes.some(h => !validHash(h))) throw Error('Invalid obsolete-program checksum.');
        if (!incoming.has(name) && await exists(join(plan.root, name))) { const sha256 = await fileHash(join(plan.root, name)); if (hashes.includes(sha256)) obsolete.push({ path: name, sha256 }); }
      }
    }
    for (const f of obsolete) {
      const name = ownedInstallerFile(f.path, payload.product, { retired: true }), path = join(plan.root, name), fromData = relative(plan.data, path);
      const inData = !fromData || (!isAbsolute(fromData) && fromData !== '..' && !fromData.startsWith('../') && !fromData.startsWith('..\\'));
      if (!incoming.has(name) && !inData) await removeOwned(path, f.sha256);
    }
    const receipt = { product: payload.product, schema: 1, installDirectory: plan.root, dataDirectory: plan.data, version: payload.version, installMethod: 'javascript', files: [...incoming].map(([path, f]) => ({ path, sha256: f.sha256 })), shortcuts: [] };
    for (const f of receipt.files) if (await fileHash(join(plan.root, f.path)) !== f.sha256) throw Error('Installed file verification failed.');
    await put(join(plan.root, 'installed.json'), null, Buffer.from(JSON.stringify(receipt, null, 2)));
    const shell = join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
    registryChanged = true;
    await call('registry', { values: { DisplayName: `${product.title} for rbxport`, DisplayVersion: payload.version, Publisher: `${product.title} contributors`, InstallLocation: plan.root, UninstallString: `"${shell}" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${join(plan.root, `Uninstall-${product.id}.ps1`)}"`, URLInfoAbout: `https://github.com/ElmoTuisk/${payload.product}`, NoModify: 1, NoRepair: 1 } });
    signal.throwIfAborted();
    result = { root: plan.root, dataDirectory: plan.data, version: payload.version, shortcuts: plan.paths.length };
  } catch (error) {
    let incomplete = false;
    if (registryChanged) try { await call('registry', { values: plan.inventory.registry ?? null }); } catch { incomplete = true; }
    for (const e of journal.reverse()) {
      try {
        await installerPath(e.path);
        const current = await exists(e.path) ? await fileHash(e.path) : 'absent';
        if (!e.after && current === e.beforeHash) continue;
        if (!e.after && e.expectedProperties && current !== 'absent') {
          const [link] = await call('links', { paths: [e.path] });
          if (JSON.stringify(link.properties) === JSON.stringify(e.expectedProperties)) e.after = current;
        }
        if (!e.after) { incomplete = true; continue; }
        if (e.after && current !== e.after) { incomplete = true; continue; }
        if (e.before) await copyFile(e.before, e.path); else if (await exists(e.path)) await unlink(e.path);
      } catch { incomplete = true; }
    }
    if (incomplete) { error = Error('Setup could not fully restore its program-file changes. Saved data was not modified; private recovery backups were retained in the setup cache.'); stage = null; }
    throw error;
  } finally {
    await releaseShared?.(); await releaseOwn();
    if (stage) { const full = resolve(stage); if (!/transaction-[^\\/]+$/.test(full) || !(await installerPath(full))) throw Error('Unsafe setup staging cleanup.'); await rm(full, { recursive: true, force: true }); }
  }
  return result;
}

export async function runJavaScriptSetup(payload, args = process.argv.slice(2)) {
  payload = validateInstallerPayload(payload);
  const title = installerProducts[payload.product].title;
  if (args.includes('--help')) { console.log(`${title} ${payload.version} JavaScript setup\nRequires Node.js 24 or newer, Windows x64, compatible rbxport and internet.\nRun: node <setup-file.mjs>\nOptions: --yes, --directory <existing-or-empty-folder>, --existing-directory <folder>, --data-directory <new-install-data-folder>, --cache-directory <folder>, --rbxport-path <exe>, --offline, --verify\nSetup connects the regular rbxport Desktop/Start Menu shortcuts. Saved data is kept; rbxport is not launched.`); return; }
  if (args.length === 1 && args[0] === '--verify') { console.log(JSON.stringify({ product: payload.product, version: payload.version, files: payload.files.length, verified: true, requiresNode: '>=24', platform: 'win32-x64' })); return; }
  if (Number(process.versions.node.split('.')[0]) < 24) throw Error('Install official Node.js 24 or newer, then run this setup file again.');
  if (process.platform !== 'win32' || process.arch !== 'x64') throw Error('This setup is for Windows x64.');
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--yes') options.yes = true;
    else if (a === '--offline') options.offline = true;
    else if (['--directory', '--existing-directory', '--data-directory', '--cache-directory', '--rbxport-path'].includes(a)) {
      const value = args[++i]; if (!value || value.startsWith('--')) throw Error(`Missing value for ${a}.`);
      const key = { '--directory': 'directory', '--existing-directory': 'directory', '--data-directory': 'dataDirectory', '--cache-directory': 'cacheDirectory', '--rbxport-path': 'rbxportPath' }[a];
      if (options[key]) throw Error(`Repeated setup option: ${a}.`); options[key] = value; if (a === '--existing-directory') options.existing = true;
    } else throw Error(`Unknown setup option: ${a}. Use --help.`);
  }
  console.log(`${title} ${payload.version} — JavaScript setup\nRequires official Node.js 24 or newer. Windows protection stays enabled.`);
  const controller = new AbortController(), cancel = () => controller.abort(Error('Setup cancelled; saved data was kept.'));
  process.on('SIGINT', cancel);
  try {
    const result = await installJavaScriptPayload(payload, { ...options, signal: controller.signal, progress: message => console.log(message), confirm: async plan => {
      console.log(`Install/update: ${plan.root}\nKeep saved data: ${plan.data}\nConnect the regular rbxport Desktop and Start Menu shortcuts.\nNo music operations will run.`);
      if (options.yes) return true;
      if (!process.stdin.isTTY) throw Error('Interactive confirmation is required. Use --yes only when you intend to install.');
      const prompt = createInterface({ input: process.stdin, output: process.stdout });
      try { return /^(y|yes)$/i.test((await prompt.question('Install / Update? [y/N] ', { signal: controller.signal })).trim()); } finally { prompt.close(); }
    } });
    console.log(result.cancelled ? 'Setup cancelled. Nothing was installed.' : `${title} ${result.version} installed. Open your regular rbxport shortcut.`);
  } finally { process.off('SIGINT', cancel); }
}
