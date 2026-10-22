# Preparing a GitHub release

Playlist Wizard is a separate project. Copy/publish this directory as its repository root; it does not need Playlist Sync's service or state. Do not copy ignored runtime/data/test-result directories or any music.

1. Complete the intended release scope and update README, architecture, changelog and validation evidence. Retain explicit live and listening limitations until verified.
2. Provision the pinned runtime with `node scripts/Install-Essentia.mjs`, then run Node.js 24 tests on Windows and Linux with FFmpeg available. Inspect every skip/failure. Live host/USB tests require authorization and should use a disposable library/device.
3. Update `package.json`, installer, packager, panel footer and relevant documentation together. Move the intended changelog entry out of Unreleased into a version heading such as `## 0.1.0 — YYYY-MM-DD` with the actual release date.
4. Build with `Package-Addon.ps1 -Destination <new-absolute-zip-path>`. Its allowlist and private-file check reject runtime/data/log/music entries and linked paths. Inspect the archive again before publication.
5. Once publication is explicitly authorized, publish source and the matching `vX.Y.Z` tag to the chosen repository. Do not guess a repository URL or claim a release before the workflow succeeds.

The independent `.github/workflows/test.yml` tests on both platforms, installs FFmpeg for the real synthetic test, requires an exact tag/package-version match and a release changelog entry, then publishes a source-only Windows setup ZIP and SHA-256 checksums. A failed platform or packaging check blocks publication. The file is nested under `playlist-wizard` in the current development workspace; it becomes the active workflow when Wizard is its own repository root. The parent repository also runs the Wizard test suite.

Retain `LICENSE`, `LICENSE-AGPL-3.0.txt` and `THIRD_PARTY.md`. For any redistributed Essentia runtime, provide the complete corresponding upstream source/build requirements as well as Wizard source; the source setup ZIP deliberately excludes compiled runtime artifacts. See the pinned source revision and dependency hashes in the notices/manifest.

No Wizard repository or public release has been created by this implementation task.
