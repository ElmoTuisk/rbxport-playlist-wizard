# Working on Playlist Wizard

Read README.md, docs/architecture.md and docs/validation.md before changing behavior. This is an independent add-on, not Playlist Sync or the upstream host application.

- Keep the sidebar and popup compact and visually cohesive with Playlist Sync. Do not add a dashboard or top-level tabs for routine set building.
- Every host operation needs current library identity; USB operations also pin volume ID, mount and library format. Never guess paths or directly access the host's music databases.
- Autosort preserves every selected song. Never silently drop missing tracks, relax hard constraints, infer musical energy from BPM alone or report unknown features as verified.
- Preserve source playlists, audio files, tags, cues and grids. Default output is a new playlist with verified membership/order. No deletion or guessed rollback after partial failure.
- Keep complete analysis, metadata-only evidence, estimated energy, user corrections and verified output distinct. Existing-file reuse is not a new download or proof of source quality.
- Use fixture libraries and synthetic audio. Do not launch/control live rbxport, edit a live USB/library or perform music downloads without explicit authorization.
- Use Node.js 24 and `node --test test/*.test.mjs`. Set FFMPEG for the real synthetic decoding test. Windows is needed for launcher syntax/behavior checks.
- Update README, changelog and validation evidence for material changes. Do not claim live compatibility, musical reliability, installation or publication without corresponding evidence.
- Keep pairing tokens, music, cookies, logs, caches and runtime binaries out of Git and release ZIPs. Private notes belong in ignored LOCAL_WORKSPACE.md.
- Release tags must match package.json. The user approved a single-file JavaScript `.mjs` installer with official Node.js 24 or newer installed first; publish that main download, public source ZIP and checksums only after both CI platforms pass. Optional custom EXE builds retain their signing and exact-candidate validation requirements, which do not block JavaScript releases. Updates preserve the existing saved-data location. Never claim general Smart App Control compatibility from fixture results.
