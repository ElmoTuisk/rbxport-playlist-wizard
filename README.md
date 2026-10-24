# Playlist Wizard for rbxport

An independent, local DJ-set builder with the same compact sidebar/popup style as Playlist Sync. **Experimental version 0.1.2 · Windows x64 · Node.js 24 or newer required for setup.** It has its own service, pairing token, installation and saved data. Both add-ons can start through the original rbxport shortcut; Playlist Sync is not required.

**Install Node.js first:** Install the official [Node.js runtime](https://nodejs.org/en/download), version 24 or newer. Download the single **`.mjs` setup file** and run it with Node; double-clicking it may open an editor. There is no source ZIP to unpack. Setup installs a verified private runtime for later regular rbxport launches.

## What works in this development build

- **Autosort every song:** take a hand-picked playlist or union of playlists and generate a new ordered copy, preserving the originals. No in-place overwrite in this version.
- Select an **exact song count** or **approximate duration** instead. Duration tolerates the larger of two minutes or 5%, and reports full runtime separately from estimated mixed runtime.
- Choose gradual build, waves, peak and hold, rise and release, wind down, or six custom energy anchors. The curve follows estimated elapsed set time.
- Use selected desktop playlists, the active collection, selected USB playlists, or all tracks in one selected USB library. Device Library and OneLibrary are separate sources/destinations.
- Analyze locally with **Essentia.js** for danceability, onset density, spectral brightness, bass balance, dynamics and sampled intro/body/outro intensity. Reuse host BPM/key and fill missing values only when excerpt estimates meet the stated strength thresholds. Make per-song energy corrections without changing music tags.
- Review requested/estimated curves, coverage and transition notes. Lock positions and regenerate the remaining songs.
- Explicitly create a **new playlist** through host commands. Read back exact membership/order, journal interrupted additions, and resume without blindly duplicating an uncertain operation.

Generation and analysis do not download music, import files, rewrite tags, change cues/grids or edit source playlists. Generated music is existing-file reuse, not newly downloaded audio. The analysis is not an audio-quality or provenance certificate.

## Setup and use

The main download is one **`playlist-wizard-0.1.2-windows-setup.mjs`**, alongside public source and checksums after Windows/Linux CI. Windows x64, official Node.js 24 or newer, compatible rbxport and internet are required. Administrator access is not required. [Distribution and signing details](docs/code-signing.md).

1. Install [Node.js 24 or newer](https://nodejs.org/en/download), then download the `.mjs` setup from [GitHub Releases](https://github.com/ElmoTuisk/rbxport-playlist-wizard/releases/latest).
2. Close rbxport. Open a terminal in the download folder and run `node .\playlist-wizard-0.1.2-windows-setup.mjs`. Review the folders and enter **y**. Setup retains the existing saved-data folder, verifies pinned Node.js/FFmpeg/Essentia.js downloads and connects the regular rbxport shortcuts. For an unregistered portable copy, add `--existing-directory "C:\path\to\installed-addon"`.
3. Open the original **rbxport** Desktop or Start Menu shortcut. Both enabled add-ons start automatically; allow up to 20 seconds for attachment. Run **Configure-Rbxport-Startup.ps1** in each installed add-on folder to enable integration later. If rbxport was already open without its local connection, close and reopen it normally once.
4. Click **Playlist Wizard** below Tag List, choose a source and settings, enable **Analyze local audio for energy and transitions**, then **Generate draft**. Essentia is the default analysis backend; Advanced also offers the previous Basic estimator. Analysis is optional and runs only when requested.
5. Review the draft and click **Create new playlist**. For USB sources, output goes to the same selected device library; this is not a full-device sync or a mirror of both USB formats.

Source launch with Node 24: run `node scripts/Install-Essentia.mjs` once, then `node src/server.mjs`; add `--demo` for fictional data with creation disabled. Set `FFMPEG` to an absolute executable path for source-launch audio analysis, or install the private runtime. `Start-Playlist-Wizard.ps1 -Detached` provides the paired browser fallback. The normal interface is the native popup.

Essentia analysis decodes the complete file, then measures up to 30 seconds each from the intro, middle and outro in a separate worker. Its descriptors influence the energy curve and sampled outro/intro transition costs. Existing host BPM/key always take precedence. Uncertain estimates remain unknown, and unavailable Essentia does not silently switch to Basic. Cached results are separated by backend/version; switching to Essentia triggers its own analysis while retaining your manual energy corrections. See [audio analysis](docs/audio-analysis.md) for the score, thresholds and limits.

Automatic attachment preserves the rbxport shortcut name/icon and removes recognized conventional add-on/sign-in shortcuts. The JavaScript launcher supplies `RBXPORT_DEVTOOLS_PORT=43822` to its host process; setup leaves the global user environment unchanged. Both services follow that exact host and stop when it exits. Starting rbxport does not analyze music or create a Wizard playlist. Existing configuration helpers remain available for disabling integration. Disabling Wizard preserves enabled Sync; disabling the last restores unchanged original shortcuts and any previous managed port setting. Customized commands are preserved. Direct executable and older Store launches bypass integration; Store rbxport 0.19.3 remains incompatible.

Updates remove obsolete program files only when their previous ownership and checksums match; recognized legacy setup scripts are also removed. Edited files, unknown files and saved data are retained.

Close rbxport before updating. Setup can stop an idle older Wizard service belonging to that exact installation; active work and unrelated processes block updates. Answer **n** to cancel, or use **Ctrl+C** during setup to request cancellation and program-file recovery. Source installation remains available with `Install-Playlist-Wizard.cmd`. No automatic updater is installed.


The shortcut targets official Node.js directly with `scripts/Start-Rbxport.mjs`. A minimized, short-lived parent starts a hidden worker and both independent services. A brief minimized console may be visible. JavaScript setup uses fixed Windows API helpers through PowerShell for shortcuts, signature checks and tool extraction; it does not run installer script files or change execution policy. Startup errors open private text in Notepad. The shared runtime survives removing either add-on. Optional EXE builds retain separate signing gates; those do not block `.mjs` releases. No universal Smart App Control compatibility is claimed.

On 24 October, native Explorer launches of the installed Desktop and Start Menu shortcuts verified both add-ons, both popups and normal close/reopen on rbxport 1.9.0, with saved state unchanged. Packaged-tool AppData redirection was detected and repaired; final commands use physical user files. This verifies startup on this machine; clean-machine JavaScript installation remains unverified. [Verification details](docs/validation.md).

Remove a managed installation through **Playlist Wizard → Installation → Uninstall…**, review the confirmation and choose **Uninstall Playlist Wizard**. Finish or cancel analysis/creation first. The helper removes only matching owned program files and its own startup registration. Music, playlists, saved settings, edited/unknown files and Playlist Sync remain. Windows **Installed apps** offers the same uninstall. Updating an older copy with JavaScript setup adds this option.

## Current limits

- Supported host command contract is pinned to rbxport 1.9.0. **Wizard installation, visible sidebar/popup, guarded library connection and source-picker loading were verified live on Windows/rbxport 1.9.0. Playlist creation and physical USB behavior remain unverified.** Unsupported identity commands block operations.
- Preview/analysis pools contain at most 10,000 distinct tracks; a large first scan can take a long time. Analysis runs serially, can be cancelled, and reuses completed cache entries on retry. Autosort and output are limited to 500 tracks. Large subset pools use a reproducible shortlist of up to 600 tracks, disclosed in the preview.
- Eligible songs need a known, positive duration of at most 30 minutes. Song-count and approximate-duration modes exclude longer recordings, unknown/invalid durations and unavailable files, with counts shown in the draft. Exclusions happen before audio analysis. Autosort preserves every song and explains any blocking tracks instead of dropping them. An ineligible locked song also blocks generation until unlocked. Ambiguous/repeated memberships require review.
- Deduplication uses host track IDs. Separate library copies of the same recording are not fingerprinted or silently merged.
- Host BPM/key reuse and Essentia excerpt estimates do not verify grids, changing keys, vocal clashes or phrase alignment. Raw beat/key strength is not an accuracy percentage. Strict harmonic matching rejects unknown keys; half/double-time transitions require listening.
- Essentia supplies measured descriptors; the combined 1–10 energy score and descriptor weights are still **hand-tuned and not listening-validated**. Absolute loudness and BPM do not directly determine energy. Descriptors describe bounded excerpts, so a mid-track breakdown or key change outside them can be missed. Basic retains the previous full-file heuristic.
- Estimated mixed duration assumes the chosen overlap in bars, clamped to a quarter of each neighboring track. Unknown BPM contributes zero assumed overlap. It is not a mixed recording or a guarantee of performance duration.
- A new USB playlist is created and populated in generated order, then read back. An unsupported order or interrupted operation leaves an explicitly reported partial playlist; no music is removed. Never change a partial target manually if you intend to resume it.
- After an uncertain create response, automatic recreation is blocked. Inspect the host before generating another copy. No deletion or guessed rollback is attempted.
- Native host commands do not offer a cross-application transaction. The shared host write lease coordinates this build with the accompanying Playlist Sync bridge update; older add-on installations and manual host edits are outside that protocol. Do not rearrange sources/targets during creation.
- There is no remote AI/agent integration yet. The deterministic offline engine is the foundation for later natural-language recipes and bounded critique/repair.

## Development

Run `node scripts/Install-Essentia.mjs` then `node --test test/*.test.mjs` from this directory with Node.js 24. Set `FFMPEG` for real synthetic decoding/Essentia tests. `ESSENTIA_DIR` can point to another absolute runtime directory; the same pinned hashes are enforced. The parent Playlist Sync suite also requires `FFPROBE`; Windows is needed for its launcher/DPAPI checks. Use fixture libraries and generated audio. Do not start either live add-on or use real music for testing without authorization.

The private data directory contains `wizard.sqlite`, analysis cache, draft/write journals and pairing information; keep it private. Source/demo launches use the supplied `--data-dir`, or `~/.rbxport-playlist-wizard`. The Windows launcher defaults to `.local-data` beside source, or the separate installed data directory. Do not package music, caches, tokens, logs or runtimes.

See [architecture](docs/architecture.md), [validation](docs/validation.md) and [changelog](CHANGELOG.md). Wizard's original/adapted source retains GPL-2.0-or-later; the Essentia integration also carries AGPLv3-or-later obligations. Keep both license texts and the attribution/source information in [THIRD_PARTY.md](THIRD_PARTY.md). This remains an independent add-on, not an official rbxport plugin API.
