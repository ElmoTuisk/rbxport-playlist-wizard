# Third-party software and source

Playlist Wizard's original/adapted source remains GPL-2.0-or-later; retain the notices and `LICENSE`. Its Essentia integration also uses the AGPL-covered software below. The combined program must be distributed with those obligations respected, including corresponding source availability. The package license expression records both components; it does not erase the original Playlist Sync notices. See `LICENSE-AGPL-3.0.txt` and the upstream license headers.

## Essentia.js 0.1.3

- Copyright Music Technology Group, Universitat Pompeu Fabra. Acknowledge the original project at <https://essentia.upf.edu/>.
- JavaScript wrapper and WebAssembly distribution: <https://github.com/MTG/essentia.js>.
- Exact package source revision: <https://github.com/MTG/essentia.js/tree/f46c91c08bdf263d5f3d575ab8fb0f9b81695acf>.
- Underlying Essentia library and build source: <https://github.com/MTG/essentia> and the build scripts at the pinned wrapper revision.
- License headers grant GNU Affero General Public License version 3 or later. The published package's metadata says `AGPL-3.0`; its complete license text is retained here and beside the installed runtime.
- Installer archive: <https://registry.npmjs.org/essentia.js/-/essentia.js-0.1.3.tgz>. Archive and extracted-file SHA-256 values are pinned in `dependencies.json`.
- Only the unmodified UMD core, inline WebAssembly module and license are installed. `.js` files are renamed `.cjs` for the host project's Node module format. No npm lifecycle scripts or TensorFlow/plotting/model packages are installed.
- The source setup ZIP excludes `.runtime` and upstream compiled artifacts. Setup fetches them directly from the pinned upstream distribution. Any future redistribution of that runtime must include or provide its complete corresponding source and build requirements, alongside Wizard's source and license notices. No pretrained models are included.

Analysis stays local. There is no audio upload to UPF, npm, a model service or any other analysis provider. Package downloads occur only during dependency setup.
