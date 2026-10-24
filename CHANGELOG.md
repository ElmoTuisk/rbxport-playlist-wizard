# Changelog

## 0.1.2 — 2026-10-24 (unreleased)

- Verify both installed original shortcuts through native Explorer, both add-on popups and normal close/reopen on rbxport 1.9.0. Repair local packaged-tool AppData redirection; preserve saved data and restore diagnostic pause arguments. Public setup signing remains outstanding.

- Remove obsolete program files during updates only after ownership/checksum verification. Recognize historical setup/packager scripts by public SHA-256 values; retain changed or unknown files and all saved data.

- Add a single-file Windows setup, managed update discovery with saved-data retention, and a separate confirmation for uninstall inside the compact popup. Preserve companion registration, edited files, music and saved data.
- Replace native/PowerShell startup dispatch with the shared JavaScript launcher and verified official Node runtime. Preserve original shortcuts/data paths, independent companion startup, paired sidebar readiness, exact-host lifetime, abandoned-owner recovery and prompt close/reopen. The parent starts minimized; a brief console may appear.
- Verify official runtime checksums and its OpenJS publisher signature before configuration. This does not sign our JavaScript or establish complete Smart App Control compatibility. Public setup signing and release-validation gates remain.
- Prepare two-stage provider signing, final signed setup verification and post-signing checksums. Publication requires the exact candidate’s successful Smart App Control validation hash; no signed release has been published.

- Start enabled add-ons concurrently through the shared launcher. Closing the owning rbxport session during startup cancels its pending launchers promptly, releases the launch lock and prevents later clicks from queuing a surprise reopen.
- Bound repeated-click waiting, recover an abandoned launch mutex, and distinguish a normal close from a startup failure. Extend synthetic concurrency/cancellation and native status checks. Saved data and companion independence are preserved.

## 0.1.1 — 2026-10-23

- Accept Explorer link-tracking metadata refreshes when every saved shortcut property is unchanged, so normal launches cannot break subsequent updates or original-shortcut restoration.
- Fix integrated rbxport shortcuts doing nothing on affected Windows configurations with the same source-built, console-free Windows launcher as Playlist Sync 0.11.4. Dispatch both enabled add-ons without allocating PowerShell consoles; setup uses that launcher too.
- Confirm Wizard's sidebar button before reporting background startup success. Surface failures through the shared launcher while still attempting the companion add-on. Preserve saved-data paths and original shortcut restoration.
- Keep an existing Node runtime when its verified checksum already matches, avoiding redundant runtime replacement on updates.
- Extend isolated Windows fixtures to execute generated shortcuts and verify console-free children, successful startup and captured failures. The generated launcher is unsigned and can be blocked by Windows application-control policies.

## 0.1.0 — 2026-10-23

- Integrate with the original rbxport Desktop and Start Menu shortcuts by default, alongside an independently installed Playlist Sync. Remove conventional extra add-on and sign-in shortcuts, preserve the original host icon and restore original host shortcuts when the last add-on is disabled.
- Follow the exact host process, cancel work and shut down on host exit; tolerate a quick reopen. Retain existing data paths on update and preserve companion registration when either add-on is disabled.
- Publish independent public source, a source-only Windows setup ZIP and checksums after Windows/Linux CI. Fixture results and release status are recorded in the validation document.

- Add checksum-pinned Essentia.js 0.1.3 analysis through an isolated worker: rhythm/tonal strength, danceability, onset rate, brightness, bass balance, dynamics and bounded intro/body/outro descriptors after complete file decoding. Use descriptor-based energy and sampled transition costs without new hidden hard constraints.
- Preserve host BPM/key; fill missing draft fields only when estimates meet the documented strength/regularity thresholds. Display raw strengths and disagreements, retain manual energy corrections across backend changes, and keep Basic as an explicit fallback. Separate caches by backend/version and refuse measured duration mismatches.
- Provision verified Essentia code through setup without npm lifecycle scripts, retain AGPL attribution/source/license information and keep compiled runtime files out of the source ZIP. Add real synthetic-audio, cancellation, cache, installer and UI checks; all 43 Wizard tests passed on Windows. Isolate worker launch flags so command-line module mode cannot prevent file-based workers from starting.

- Fix one long or unknown-duration recording blocking every song-count/duration draft from a larger source. Exclude ineligible recordings before audio analysis, disclose counts in the visible preview and retain the 30-minute validation limit. Explain autosort blockers and refuse to drop locked songs. Add regression coverage for a 1,026-track pool containing two two-hour recordings. All 31 Wizard tests passed, and the installed fix generated a metadata-only 20-song preview on the live library.

- Add optional automatic attachment alongside Playlist Sync when compatible rbxport opens normally. Keep independent hidden services, preserve the other add-on when disabling startup and restore the original user connection setting when disabling the last. Verify normal Explorer close/reopen with both buttons visible; no full Windows sign-in test was performed.

- Create Playlist Wizard as an independent add-on with its own service, data, launcher, installer and compact sidebar popup.
- Add autosort into a new playlist, exact song counts, approximate mixed duration, energy presets/custom anchors, track locks and local energy corrections.
- Add bounded, reproducible joint selection/sequencing with tempo/key constraints, metadata coverage and explicit uncertainty.
- Add optional full local audio decoding and a versioned, gain-resistant experimental intensity cache. No downloads or source-file rewrites.
- Add desktop/USB source adapters and guarded fresh-playlist creation with native order readback, durable partial-write recovery and blocked blind recreation after uncertain creation.
- Add isolated fixtures, synthetic audio checks and parent CI coverage. Live sidebar/library connection was subsequently verified on Windows/rbxport 1.9.0 during authorized installation; playlist creation, USB behavior and listening quality remain unverified. Public release evidence is recorded in the validation document.
- Populate sources automatically when the launcher opens the popup, without scanning/analyzing tracks or writing playlists. Add a fixture regression for this first-open behavior.
