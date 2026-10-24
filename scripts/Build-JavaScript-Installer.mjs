import { readFile as buildReadFile, writeFile as buildWriteFile, mkdir as buildMkdir, readdir as buildReaddir, lstat as buildLstat } from 'node:fs/promises';
import { join as buildJoin, dirname as buildDirname, resolve as buildResolve } from 'node:path';
import { fileURLToPath as buildFileURLToPath } from 'node:url';
import { createHash as buildCreateHash } from 'node:crypto';
import { encodeInstallerPayload, ownedInstallerFile } from './Installer.mjs';

export async function buildJavaScriptInstaller({ root = buildFileURLToPath(new URL('../', import.meta.url)), destination } = {}) {
  root = buildResolve(root);
  const pkg = JSON.parse(await buildReadFile(buildJoin(root, 'package.json'), 'utf8'));
  const product = pkg.name.replace(/-addon$/, '');
  if (!['rbxport-playlist-sync', 'rbxport-playlist-wizard'].includes(product)) throw Error('Unknown installer product.');
  const files = [];
  async function add(path) {
    ownedInstallerFile(path, product);
    const full = buildJoin(root, path), info = await buildLstat(full);
    if (!info.isFile() || info.isSymbolicLink()) throw Error('Linked or nonregular build input refused.');
    const bytes = await buildReadFile(full);
    files.push({ path, sha256: buildCreateHash('sha256').update(bytes).digest('hex'), content: bytes.toString('base64') });
  }
  async function directory(path) {
    if ((await buildLstat(buildJoin(root, path))).isSymbolicLink()) throw Error('Linked build directory refused.');
    for (const entry of (await buildReaddir(buildJoin(root, path), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const name = `${path}/${entry.name}`;
      if (entry.isSymbolicLink()) throw Error('Linked build input refused.');
      if (entry.isDirectory()) await directory(name); else await add(name);
    }
  }
  for (const name of ['src', 'public', 'scripts', 'docs']) await directory(name);
  const id = product.endsWith('-sync') ? 'Playlist-Sync' : 'Playlist-Wizard';
  for (const name of ['README.md', 'AGENTS.md', 'CHANGELOG.md', 'LICENSE', 'package.json', 'dependencies.json', 'release-signing.json', `Start-${id}.ps1`, `Stop-${id}.ps1`, `Uninstall-${id}.ps1`, `Launch-${id}.cmd`, 'Configure-Rbxport-Startup.ps1', ...(id === 'Playlist-Sync' ? ['PROJECT_OVERVIEW.md', 'manifest.json'] : ['THIRD_PARTY.md', 'LICENSE-AGPL-3.0.txt'])]) await add(name);
  files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  const payload = { schema: 1, product, version: pkg.version, files }, encoded = encodeInstallerPayload(payload);
  const windows = await buildReadFile(buildJoin(root, 'scripts/Installer-Windows.mjs'), 'utf8');
  const core = (await buildReadFile(buildJoin(root, 'scripts/Installer.mjs'), 'utf8')).replace(/^import \{ createWindowsOps \} from '\.\/Installer-Windows\.mjs';\r?\n/m, '');
  const source = `// ${product} ${pkg.version}: one-file JavaScript setup. Requires official Node.js >=24.\n// Public source: https://github.com/ElmoTuisk/${product}\nimport { fileURLToPath as setupFilePath } from 'node:url';\n${windows}\n${core}\nexport const setupPayload = decodeInstallerPayload(${JSON.stringify(encoded.content)}, ${JSON.stringify(encoded.sha256)});\nif (process.argv[1] && resolve(process.argv[1]) === setupFilePath(import.meta.url)) {\ntry { await runJavaScriptSetup(setupPayload); }\ncatch (error) { console.error('Setup failed: ' + error.message); process.exitCode = 1; }\n}\n`;
  destination = buildResolve(destination ?? buildJoin(root, 'dist', `${product.replace('rbxport-', '')}-${pkg.version}-windows-setup.mjs`));
  await buildMkdir(buildDirname(destination), { recursive: true }); await buildWriteFile(destination, source, { flag: 'wx' });
  return { product, version: pkg.version, files: files.length, destination, sha256: buildCreateHash('sha256').update(source).digest('hex'), bytes: Buffer.byteLength(source) };
}
if (process.argv[1] && buildResolve(process.argv[1]) === buildFileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  try {
    if (args.length && (args.length !== 2 || args[0] !== '--destination')) throw Error('Use --destination <new-file.mjs>.');
    console.log(JSON.stringify(await buildJavaScriptInstaller({ destination: args[1] })));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
