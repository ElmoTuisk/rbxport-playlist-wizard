# Validation record

## Obsolete program cleanup

After the user requested old-file removal, both installers gained cleanup of unchanged previous-receipt files absent from the new program set, plus known historical setup/packager scripts identified by public SHA-256 values. Planning validates the full old receipt before deletion; paths stay within the owned program allowlist and outside the saved-data directory. Deletion rechecks checksums. Updated Windows installation fixtures verify removal of an obsolete file while preserving an edited obsolete file, current program files, music and saved data; both passed. Wizard’s retained Essentia runtime remains in the current file set. Historical source/setup ZIPs are not swept automatically because unrecognized archives may be user backups. In the specifically authorized local cleanup, seven verified early setup/source ZIPs, three unchanged legacy setup/packager scripts and three unused generated-launcher/cache files were removed. The cleanup rechecked original shortcut, registration, installation-record and available saved-data hashes; it completed without changing protected files. No host launch, music operation or security-policy change was performed.

## Trusted signing preparation — unreleased

The maintainer confirmed an individual publisher based in Estonia. No certificate or provider approval is available. The current code requires trusted timestamped signatures before changing shortcuts, ships a prebuilt launcher instead of compiling locally, and prepares staged signing of scripts/launcher followed by the outer setup. Publication additionally checks the exact setup’s recorded Smart App Control validation hash. See the [code signing policy](code-signing.md). Signing-provider XML templates and both signing requests remain untested until onboarding. The signed installer, clean-machine lifecycle, all upstream binaries under Smart App Control and live in-popup uninstall remain unverified.

Wizard now has a setup EXE source, managed receipts/update discovery and explicit in-popup uninstall. Isolated checks cover confirmation, active-work rejection, concurrent-action locking, helper-launch failure recovery, saved-data retention, exact process ownership, companion registration and edited/music sentinel retention. These do not establish a completed signed release or live host uninstall.

Local Windows final regression run: **189/189 Sync tests passed, no skips; 55/56 Wizard tests passed, one skip**. The skipped Wizard test attempted the unsigned synthetic native EXE and was blocked by Application Control; the separate startup configuration/companion/readiness tests passed. An earlier run executed that same fixture successfully, demonstrating why fixture success is not a Smart App Control guarantee. Real FFmpeg/ffprobe and Wizard Essentia used synthetic audio; external fetches were blocked and API tests used loopback. Staging tests compiled only unsigned internal inputs, checked product/version metadata and unchanged script bytes, and verified that pending/unsigned inputs cannot produce a distributable setup. Signature-result fixtures cover tampering, untrusted/wrong publishers, missing timestamps/files and retained legacy setup files. No live rbxport launch, installation, uninstall, music download or library write was performed in this signing-preparation pass.

## Current Smart App Control blocker

After the latest manual check, the user confirmed Smart App Control blocked the unsigned helper EXE. This remains unresolved; successful Windows/Linux CI is not evidence of compatibility with that policy. Sync v0.11.4 and Wizard v0.1.1 are marked as pre-releases with a prominent warning; their assets and immutable tags were not changed. Versions 0.11.5 and 0.1.2 on main remain unreleased.

On the user's installation, the two verified original rbxport shortcut backups were restored to launch the host directly. Add-on data and registration backups were retained; automatic attachment is unfinished. No Windows security setting was changed. A possible signed-Windows-host approach passed an isolated fixture, but deployment was rejected by automatic approval review as potentially bypassing the intended application-control boundary. The user chose trusted publisher signing instead. The Windows-host proposal was abandoned, its local preview archived, and it has not been deployed or published. No usable local signing certificate was found. The final startup fix and release verification remain outstanding.


## Closing during startup — follow-up correction

The user's final Desktop check opened rbxport before its add-ons appeared; closing it and clicking again left startup queued. The captured process state showed an add-on readiness launcher still waiting after that host had exited. This was not covered by the successful 0.11.4/0.1.1 CI; earlier visibility checks did not establish this close/reopen case.

Sync 0.11.5 / Wizard 0.1.2 dispatch both launchers concurrently, watch the exact host PID while waiting, cancel only their own short launcher children on host close and release the mutex promptly. Repeated-click waiting is bounded to five seconds; abandoned mutex ownership is recovered. Services retain their existing exact-host lifetime watchers and all music/library guards. Native status distinguishes a normal close from readiness/failure. Synthetic fixtures require Wizard to start while Sync is waiting and cancel two sleeping launchers on synthetic host exit. Final native execution on the local machine remains subject to the documented Code Integrity policy blocks; CI and manual evidence are recorded separately when obtained.


## Shortcut launch correction — 23 October 2026

The previous programmatic Explorer/ShellExecute checks did not establish that ordinary user clicks worked. The user subsequently confirmed that the 0.11.3/0.1.0 shortcuts did nothing. Fresh PowerShell-target shortcut files also failed. A console-free native shortcut target opened the app, but add-on launch still failed until its PowerShell children also used explicit console-free process creation. After that change, authenticated services connected to the same host PID and the user confirmed both sidebar entries were present. These checks used temporary automatic-sync pause; saved scheduling preferences were not changed.

Both affected distributions now include public C# launcher source and matching installer/shortcut changes. Background launchers check sidebar readiness before returning. Windows fixtures exercise generated .lnk dispatch, synthetic console-free PowerShell children, companion dispatch, ready/error status and failure capture, without real music or library operations.

Local validation encountered Windows Code Integrity application-control blocks on newly compiled fixture EXEs (events 3077/3033), including outside the sandbox. Security policy was not changed. Those blocked cases are not passing test evidence. The already-running diagnostic launcher opened successfully; the new release still requires clean Windows CI and release verification. This supersedes the earlier shortcut-success wording below; prior test and release counts remain historical.


Updated 23 October 2026. Experimental version 0.1.1. Fixture results do not establish live host compatibility or musical quality.


The updated Wizard installer also passed an isolated offline update with verified cached dependencies, downloads/fetch blocked and its synthetic saved-data marker retained. The Sync ownership fixture now includes the actual new C# source file. Shortcut records compare saved public properties as well as file hashes, accepting Explorer tracking-only changes while preserving customized commands/descriptions; the tracking-change and original-byte restore fixture passed.

Final local fixture results cover all 185 Sync and 47 Wizard tests with passing results across the full sandbox runs and targeted reruns, with no skips. Sandbox runs passed 178/185 and 42/47; six Sync and five Wizard loopback failures passed the 21-test external-fetch-blocked API/OAuth rerun. Sync's separate install/update fixture exposed a transient identical-runtime overwrite lock; checksum-preserving runtime reuse fixed it and both installation tests passed. The final console-free startup fixtures for both distributions passed, including real generated shortcut dispatch, failed-Sync/continuing-Wizard dispatch and error capture. Earlier Code Integrity blocks remain an environmental limitation, not passing evidence; final builds use the same compiler target as the working prototype. Real FFmpeg/ffprobe, pinned Essentia and Windows DPAPI were included. Clean CI and published-asset verification are recorded separately after completion.
## Original shortcut integration — 23 October 2026

All **47 Wizard tests** have passing Windows/Node 24 results, with real synthetic FFmpeg and pinned Essentia; none skipped. The full sandbox run passed 42, with five API fixtures blocked by loopback EACCES; all five passed outside the sandbox with external fetches blocked. Final startup/cancellation corrections passed targeted reruns. The original 43-test evidence below remains historical.

Fixtures cover shared launcher registration and disable, migration from Sync's previous wrapper, conventional extra shortcut cleanup, original icon references, byte-exact original restoration, repeated host launch and exact-PID background service binding. Real synthetic process tests verify exit detection. The owning-session API fixture aborts a pending cancellable task, stops the watcher and closes the service idempotently. No real music, host library or USB is used. Live deployment and public CI/release evidence are appended after verification.

With the user's authorization, both existing idle installations were updated from the tested public-source allowlists; installed code hashes matched and their original data locations were retained. Add-on-only read-only database snapshots verified unchanged Sync settings/links/bindings and Wizard draft/cache/write state. Five Sync links remained. Original per-user Desktop and Start Menu rbxport shortcuts now point to the neutral launcher and retain the original executable icon reference; conventional add-on Desktop, Start Menu launch/stop and Windows Startup entries were removed. Customized command shapes are excluded from cleanup.

The first live launch exposed `Start-Process -Wait` following the persistent Node descendant and blocking the companion. The launcher now calls the short process's `WaitForExit()` directly, and the regression fixture rejects descendant waiting. Both final startup fixtures passed again.

The original Desktop shortcut and then the original Start Menu shortcut were launched through Explorer, with a temporary diagnostic `-PauseAutomatic` argument restored byte for byte immediately after launch. Each cycle verified one rbxport 1.9.0 process, both authenticated services connected and bound to its exact PID, both idle, and exactly one visible adjacent Sync/Wizard sidebar button. A normal host-window close stopped both service processes in each cycle. Read-only add-on snapshots stayed identical. `Get-StartApps` listed exactly one rbxport entry and none of the separate add-on launch/stop entries. This verifies the available app entry, not a universal Windows Search ranking guarantee. No audio acquisition, music analysis, import, playlist write, USB operation or saved-scheduling change was started. The host was left closed, as found. Other host versions and a full Windows sign-in remain untested.


Published verification: [Sync v0.11.3](https://github.com/ElmoTuisk/rbxport-playlist-sync/releases/tag/v0.11.3) and [Wizard v0.1.0](https://github.com/ElmoTuisk/rbxport-playlist-wizard/releases/tag/v0.1.0) are public. [Sync release CI](https://github.com/ElmoTuisk/rbxport-playlist-sync/actions/runs/39862062605) and [Wizard release CI](https://github.com/ElmoTuisk/rbxport-playlist-wizard/actions/runs/39862027020) passed both platforms before publication. Windows passed 185 Sync and 47 Wizard tests without skips; Linux passed 180 and 46, skipping only the five/one Windows-specific checks. Slow Ubuntu mirror downloads required cancelled infrastructure attempts and fresh-runner reruns; no platform gate was removed.

Downloaded release assets matched GitHub SHA-256 digests and their published SHA256SUMS files. Sync provides the required 309,760-byte single-file setup EXE plus its 88-entry source ZIP; its EXE embedded-payload verification passed. Wizard provides its 122,876-byte, 57-entry source-only Windows setup ZIP. Both archives passed the private-data/compiled-runtime scan. All 33 Sync and 28 Wizard published program/UI/helper/launcher files matched the installed versions after line-ending normalization. Documentation-only evidence corrections follow the immutable release tags on main. Final inspection retained only rbxport.lnk on the Desktop and one rbxport Start Menu app entry, with the host and both services closed.

## Automated implementation checks

The Essentia integration full run passed **all 43 Playlist Wizard tests**, with no skips, on Node.js 24.19.0 / Windows. Real FFmpeg and checksum-verified Essentia.js 0.1.3 analyzed synthetic audio; API traffic stayed on loopback and external fetches were blocked. Analysis workers explicitly reject network fetch. The Windows startup fixture replaced user-environment access. This supersedes the earlier 31-test and split-run evidence.

## Essentia integration — 23 October 2026

The npm archive's SHA-512 integrity matched registry metadata. Its archive SHA-256 and the three installed file hashes were then pinned. Real Node 24 execution confirmed the UMD/WebAssembly build and required algorithms work in this Windows environment. No npm lifecycle scripts or pretrained models were installed.

The 43-test full run covers real pulse/silence fixtures, approximate 120 BPM detection, raw tonal strength, bounded sections and sample positions, gain-resistant scoring, retained source bytes, complete decoding, damaged files, measured duration mismatch, missing/modified runtime, worker cancellation/timeout, parent CLI flag isolation and cached offline dependency installation. Strength-gating tests preserve unknowns and retain host BPM/key; service tests isolate backend caches, retain manual corrections, refuse stale measured duration and verify no source metadata is rewritten. Optimizer tests confirm sampled outro/intro metrics add soft costs while existing hard constraints remain enforced. UI tests expose descriptors/strengths without accuracy percentages. These results do not establish musical accuracy or better DJ sets.

The actual Windows installer and update completed in an isolated fixture with both PowerShell download calls and Node fetch blocked, using verified cached Node/FFmpeg/Essentia distributions. It preserved the synthetic saved-data marker, and the installed runtime reported Essentia 0.1.3 available. No host, service or real music job was started by this setup check.

A separate headless Edge fixture exercised the production analysis/backend controls and displayed synthetic Essentia metrics. At 800×800 and 320×420, the popup fit the viewport, no horizontal overflow/browser errors occurred, and Create remained reachable through internal scrolling. Dirty settings continued to block creation. This was a separate profile with all page network requests blocked, not control of the user's host window.

The existing independent installation was updated while Wizard was idle. Its 26 source/UI/helper/document files were hash-verified, its pinned runtime reported available, and the existing draft was retained. rbxport was disconnected at that check; no host process was started or restarted. An installed-copy synthetic check exposed inherited `--input-type=module` breaking a file-based worker; explicit worker flag isolation fixed it and a regression now covers that launch mode. After updating the two affected files, the installed private Node/Essentia analyzed a generated 95-second file, retained exactly three 30-second excerpts, estimated about 120 BPM and produced finite descriptors/energy. The service remained idle. No real music was analyzed by that check.

No bulk real-music reanalysis, live playlist creation, physical USB write, Windows sign-in cycle or listening benchmark was performed for this integration. CI definitions provision the pinned runtime, but local tests do not establish completed GitHub Actions runs. AGPL license/source notices accompany the source; compiled Essentia artifacts remain excluded from the source ZIP.

## Duration-pool failure and installed fix — 23 October 2026

Read-only diagnosis of the user's seven selected playlists found 1,026 distinct available tracks with known durations. Two were reported as 7,338 and 6,989 seconds. FFprobe confirmed matching two-hour file durations and roughly 294/280 MB MP3 sizes. The host duration mapping was correct: a global optimizer precondition rejected the whole source pool, even when only a small subset was requested.

Subset eligibility now excludes unknown/invalid durations and recordings over 30 minutes before audio analysis. The 30-minute limit, exact requested counts, transition constraints and source snapshot guards remain enforced. Autosort refuses to silently drop a song, and locked ineligible songs remain blockers. The preview shows exclusion counts without expanding notes.

Regression fixtures cover both subset modes, zero/null/nonfinite/negative durations, the exact 30-minute boundary, insufficient eligible pools, autosort/lock refusal, independent output validation and visible exclusion counts. A synthetic 1,026-track service fixture containing the same two excessive duration values generated 20 songs and called the analyzer only for the 1,024 eligible tracks. The full 31-test suite passed with no skips.

Before cleanup, the fixed optimizer generated a metadata-only 20-song draft from a live 1,156-track playlist union, reporting exactly two over-limit exclusions. This used the current source metadata without decoding real audio or writing a playlist. The selected union differed from the original failure's seven-playlist selection; it is a second live eligibility check, not an identical musical benchmark.

The user subsequently explicitly requested removal of the two collection entries and their audio files. A one-time maintenance script rechecked recording identity, current library identity and the exact file paths/sizes/timestamps. It used the native collection-removal command under the cooperative write lease and verified that every other membership/order remained unchanged across all 15 host playlists. Only those two verified MP3 files were then deleted. This was an authorized manual cleanup, not a new Wizard deletion capability.

The three changed production files were copied into the existing independent installation and hash-verified. Only the idle Wizard service restarted; the same rbxport process and Sync service remained running. The installed paired API generated a valid 20-song metadata-only preview, confirmed both removed IDs absent and no playlist creation journal, and opened the popup for review. Live playlist creation and physical USB behavior remain unverified.

Coverage includes validated recipes, Camelot conversion, exact source membership in autosort, deterministic seeds, exact count, duration with clamped overlaps, locks, impossible hard constraints, cancellation and disclosed shortlisting. An independent validator rejects unknown/repeated songs, changed locks, transition-limit violations and duration misses.

Service fixtures cover missing files, private-path confinement, changed library and USB identity, stale metadata, analysis-cache invalidation, persistent/clearable manual energy corrections, idempotent creation and exact output order. A 70-song fixture loses the response after the first 64 entries were actually added; a restarted service reads the saved target and completes it without duplicate entries. Unknown creation outcomes block blind recreation. A host that scrambles supplied order leaves an explicit partial result.

A 501-track fixture confirms audio analysis is available for large subset pools; analysis is not limited to output size. Identity is rechecked before and after each uncached decode. A simulated library change during analysis prevents accepting the new cache entry.

Command tests run the actual serialized host expressions against mocked native commands. They establish argument shape, BPM x100 conversion, source namespaces, identity checks, output ordering requests and failure handling. They **do not prove that an installed host or physical USB implements those contracts**.

Synthetic PCM tests show that a gain change does not change the experimental intensity score for the tested signals, that rhythmic envelope activity affects its features, and that silence stays low. A real FFmpeg test generates a WAV, decodes it through the production analyzer, checks bounded score/version, compares unchanged source bytes, and rejects a non-audio MP3 and cancelled work. These signals do not establish musical energy accuracy or recording provenance.

## UI fixture checks

A separate headless Edge profile rendered the production sidebar installer, panel and stylesheet against fictional data, with all page requests blocked. Source/count selection reached the generation action, draft changes disabled creation until regeneration, and no browser errors occurred. The popup stayed inside both **800×800** and **320×420** viewports; the Create action was reachable through internal scrolling, with no horizontal overflow. This was not the user's running browser or rbxport window.

## Playlist Sync regression checks

The accompanying Sync bridge's only Wizard integration is a neutral main-context write lease. A deferred native-promise test confirms another add-on cannot enter during the write and that the lease lasts until native completion. Library guards remain in place.

All **174 existing-plus-lease Sync tests** have passing results across the sandbox run and targeted reruns, with real FFmpeg/ffprobe and Windows DPAPI enabled and no skips. The final full sandbox run passed 170; four API/OAuth fixtures were blocked by loopback EACCES and passed in the 13-test targeted API/OAuth rerun with external fetches blocked. Earlier default sandbox temporary directories also caused fixture rename EPERM; using an ignored workspace test directory resolved those filesystem failures.

## Not established

- Live playlist creation in rbxport by Wizard.
- Actual USB volume identity, both device formats and native append-order behavior on a physical device.
- Musical energy calibration, listener preference over simple baselines, cue/phrase/vocal compatibility, or a reliability percentage.
- First-time internet installation on a clean machine, GitHub Actions results, or a public release.

The initial implementation checks above performed no live rbxport operation, real music analysis/download, existing playlist edit or physical USB write. The later authorized connection-only installation is recorded below. The maintained CI definitions are configuration, not completed CI evidence.

## Authorized Windows installation and connection — 22 October 2026

Subsequent user-authorized startup work verified both Wizard and Sync visible together, with one adjacent sidebar button each. Both independent hidden Windows sign-in launchers were configured and the current user's connection port enabled. rbxport 1.9.0 was normally closed, then its regular Desktop shortcut opened through Explorer, without either add-on launcher or a per-launch port override. Both services reattached automatically to the new host process. A full Windows sign-out/sign-in was not performed. No Wizard scan, analysis, draft generation or playlist write was started. Its independent Windows startup fixture covers repeated enable, companion-aware disable, original-port restoration, conflicting/later-changed ports, hidden shortcuts and a background launcher that never opens the host. The parent startup/desktop/bridge selection passed 11 checks with no skips.

At the user's request, Playlist Wizard 0.1.0 was installed into its separate normal Windows program/data directories, using checksum-verified cached dependencies. All 15 installed runtime source/UI/helper files matched their source hashes. Its Desktop and Start Menu shortcuts were created. The compatible rbxport executable reported 1.9.0; no host or add-on service was running at the initial inventory.

The installed launcher started rbxport and Wizard. Read-only checks confirmed the actual sidebar button and open popup were visible, the popup fit the viewport, and the guarded library connection succeeded. The source picker exposed the two desktop choices; no USB source was available in that session. No track scan, audio analysis, draft generation, music download/import or playlist write was started.

The first launcher-open check exposed an empty source picker until Refresh sources or a sidebar click. The paired open endpoint now loads source metadata automatically. Its new API fixture confirms only identity/playlist/device metadata calls are made. All three API fixtures passed with external fetches blocked. The fix was applied to the idle installed Wizard service and that service restarted while the same rbxport process stayed running. A final check confirmed a visible populated popup, successful library connection, no active operation and no draft. This establishes installation and connection, not playlist-output or USB compatibility.

## Isolated setup smoke check

The Windows installer completed with `-NoLaunch -NoShortcuts` into an ignored workspace fixture, using cached Node.js/FFmpeg distributions whose SHA-256 hashes matched the pinned dependency manifest. Network download calls were blocked. The installed private Node reported 24.19.0 and successfully imported the installed service module with all imports inside the independent installation; no service or host was started. A second fixture installation preserved a synthetic saved-data marker and updated program hashes to match the tested source. PowerShell syntax checks passed for Start, Stop, Install, Package and Desktop scripts. This does not establish a first-time internet install, real shortcut behavior or live startup.

## Sequencer microbenchmark

One Windows/Node 24 run over synthetic metadata gave the following results. These timings exclude source enumeration, disk I/O, audio analysis, host writes and human listening; they are not whole-library performance guarantees.

| Pool | Request | Candidates | Time |
| --- | --- | --- | --- |
| 500 | Autosort all 500 | 500 | 1,514 ms |
| 1,000 | Select 30 songs | 600 | 209 ms |
| 10,000 | Select 30 songs | 600 | 221 ms |
| 10,000 | Approximately 90 minutes | 600 | 236 ms |

The duration example selected 25 songs and estimated 91 minutes of mixed runtime. A source-only development setup archive was built and inspected: 39 entries, with required documentation/workflow files present and no runtime, private state, logs or music. A SHA-256 checksum was generated alongside it. This is a local development artifact, not a public release.
