# Playlist Wizard architecture

Version 0.1.2 uses the Sync 0.11.5 helper: dispatch both add-ons concurrently, poll exact-host lifetime during readiness, cancel pending short launcher processes on host exit and release the startup mutex. Repeated-click waits are bounded and normal close has a separate native Closed status.

Version 0.1.1 uses the identical public `RbxportLauncher.cs` and PowerShell helpers shipped by Sync 0.11.4. Configuration compiles a console-free Windows shortcut target with the installed .NET Framework compiler, caching source/output SHA-256 hashes. Both native-to-helper and helper-to-add-on dispatch use `UseShellExecute=false` and `CreateNoWindow=true`. Wizard background startup confirms its sidebar button before returning. The shared native launcher records local status/errors and displays startup failures; it waits for launcher processes, not persistent descendants. Source remains in the ZIP; compiled runtime binaries do not. The generated launcher is unsigned and subject to Windows application-control policy.

Playlist Wizard is independently runnable and installable. Runtime imports stay inside this directory. It never opens Playlist Sync state, starts sync jobs or calls acquisition providers. Both add-ons can connect to the same opt-in host automation port using distinct CDP bindings, sidebar IDs and globals.

`Configure-Rbxport-Startup.ps1` registers Wizard with the neutral shared launcher and sets the user's `RBXPORT_DEVTOOLS_PORT=43822`. The original rbxport Desktop/Start Menu shortcuts start the selected host once, then both enabled independent services. Both distributions carry identical Startup, HostShortcuts and Start-Rbxport helpers; configuration under `%LOCALAPPDATA%\rbxport-addons` holds registrations, the host executable, original environment setting and hash-checked original shortcut backups. The launcher lives there independently of either installation. Disabling one add-on preserves the other; disabling the last restores unchanged shortcuts and the original port unless independently changed. Conventional separate add-on/sign-in shortcuts are removed after command/package checks. Each service follows the exact host PID, cancels and closes on confirmed exit, and waits for the previous session on a quick reopen. No pairing token, library state or runtime dependency is shared. The host executable is unchanged.

| File | Responsibility |
| --- | --- |
| `src/server.mjs` | Paired loopback API on port 43823, host attachment, events and independent lifecycle |
| `src/bridge.mjs`, `src/host-commands.mjs` | Main-frame-only CDP transport and allowlisted guarded commands |
| `src/host-ui.mjs`, `public/` | Minimal sidebar entry, popup and standalone fallback |
| `src/wizard.mjs` | Source snapshots, analysis/cache, serialized generation, journaled creation and verification |
| `src/recipe.mjs`, `src/optimizer.mjs` | Validated settings, Camelot mapping, directed transition scores, bounded beam search and independent result checks |
| `src/analysis.mjs` | Complete local FFmpeg decode, bounded PCM processing and experimental intensity summaries |
| `src/essentia-analysis.mjs`, `src/essentia-worker.mjs` | Complete 44.1 kHz decode, bounded excerpt capture and cancellable isolated Essentia execution |
| `src/essentia-features.mjs`, `src/track-features.mjs` | Measured descriptors, experimental score, strength gates and host-first feature merging |
| `src/essentia-runtime.mjs`, `scripts/Install-Essentia.mjs` | Pinned archive/file verification, allowlisted extraction and backend availability |
| `src/store.mjs` | Private SQLite document buckets; no host database access |

Every host operation establishes the active desktop library identity. USB operations additionally re-enumerate the pinned volume ID, mount and library format. Source snapshots include exact IDs, metadata and file stat stamps. Writes refuse changed snapshots. Device IDs are never passed to desktop membership commands. Missing capabilities have no guessed-path fallback.

The host's `device_playlist_edit` source contract accepts create/add. Output uses a fresh target and append batches; readback verifies that the host preserved exact order. No device remove/delete command, automatic import, full USB synchronization or in-place reorder is exposed by Wizard.

The neutral `window.__rbxportAddonWriteLease` guards each native mutation while its promise is pending. The accompanying Sync bridge patch observes the same lease. It deliberately does not expire during a pending native promise. It is not an atomic source-snapshot/write transaction or protection against an old add-on/manual host edit. Native errors and uncertain results remain explicit.

Write journals bind one draft to one target. Unknown creation outcomes block blind recreation. Known targets can resume only when their readback is an exact prefix of the planned IDs. Completed drafts are idempotent. On interruption no playlist or music is automatically deleted.

Analyzer cache keys include library/device namespace, track ID, backend and version; file stat stamps invalidate entries. Manual corrections retain their original, backend-independent keys. Basic can reuse its original cache entries. No raw decoded audio is saved. All local paths/cache records remain in private state; the panel receives only the features needed for review. File stat equality is a fast cache check, not a content/provenance proof.

Uncached analysis revalidates the pinned library/device identity before and after decoding and accepts a cache entry only when its file stamp still matches the snapshot. Pools up to 10,000 tracks can be analyzed serially, independently of the 500-song output limit. Cancelling retains completed cache entries for the next attempt.

Before audio analysis, eligibility separates unavailable files, unknown/invalid durations and recordings over 30 minutes from a subset request. Song-count/duration modes disclose each exclusion count; the draft preview shows them directly. Autosort retains its complete-membership promise and reports blockers with sample titles and corrective options. Locked ineligible songs cannot be dropped. The optimizer repeats duration eligibility for direct callers, and independent output validation rejects an invalid selected duration. Source snapshots still include excluded tracks so later changes invalidate a pending output.

The current beam search keeps 12 states and up to eight expansions per state, yields between positions and has a 15-second budget. Autosort includes every candidate; subset search caps its shortlist at 600 and discloses it. A failed bounded search is reported as no draft found, not a proof of mathematical infeasibility.

Essentia.js is the default requested-analysis backend. Complete FFmpeg decoding feeds a bounded collector at 44.1 kHz; at most three 30-second windows reach an isolated, cancellable worker. Essentia measures rhythm, tonal strength, danceability, onsets, dynamics/loudness, centroid and bass ratio. Host BPM/key take precedence; thresholded estimates fill missing draft values only. Body energy fits the curve and sampled outro/intro features add soft transition costs. Missing runtime never silently selects Basic. Measured duration mismatches block generation. Details, scoring weights and limitations are in [audio analysis](audio-analysis.md).

Basic retains the earlier complete-file envelope/brightness/bass/crest/activity heuristic as an explicit alternative. Both energy mappings remain experimental. Neither backend optimizes cue-region pairs, detects vocals or establishes musical phrase boundaries. Calibration and independent listening evidence are required before claiming musical reliability. Adding an agent, trained features and transition audition remains future work.
