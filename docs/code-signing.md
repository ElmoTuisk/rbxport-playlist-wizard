# JavaScript setup and optional EXE signing

The main download is one `*-windows-setup.mjs` file. **Install official Node.js 24 or newer first**, then run `node <downloaded-file.mjs>` and review the setup confirmation. Windows x64, compatible rbxport and internet are required. The add-on's source ZIP is for development and need not be extracted for installation.

The user explicitly selected this distribution format and accepted the Node prerequisite. JavaScript setup and regular-shortcut startup build no custom EXE and do not wait for SignPath approval. Existing releases based on the old native helper remain historical; users must install the new JavaScript release to receive the correction.

## What setup verifies

The single file embeds bounded public program payloads and per-file SHA-256 values. Downloads have pinned HTTPS sources/checksums; extracted audio/analysis tools are checked before installation. Official Node remains unchanged and its OpenJS publisher signature is verified before it is installed privately. Saved-data paths are retained, existing installation identities are checked, and music, pairing files, credentials and private logs are excluded from payloads.

Users see the destination and retained data folders plus the regular rbxport shortcut changes before confirming. Setup requests cancellation with Ctrl+C, journals program/shortcut/registration changes, and recovers failed writes without touching music or saved data. Unrecognized services and active work block updates. The host is not launched by setup. Removing one add-on retains its companion; the last managed registration restores unchanged original shortcut bytes.

Fixed Windows API operations use PowerShell with JSON input. The JavaScript installer does not execute PowerShell installer files or override execution policy. Existing managed uninstall/configuration helpers remain available. No trust root, Smart App Control, SmartScreen, file-unblocking or other protection setting is changed.

## Release pipeline

1. Pass Node.js 24 tests on Windows and Linux. Tags match `package.json` and the Sync manifest.
2. Build the single-file JavaScript setup with `node scripts/Build-JavaScript-Installer.mjs`.
3. Run the exact generated file with `--verify`; also test fixture install/update/failure recovery/shortcut/uninstall behavior.
4. Package public source, scan inputs, and compute SHA-256 values for the final `.mjs` and source ZIP.
5. Publish the setup, source ZIP and `SHA256SUMS.txt` only after both test platforms pass.

Checksums detect corruption when compared with an independently trusted value. They are not a publisher signature. The official runtime's signature does not sign our JavaScript, and fixture success does not establish universal Smart App Control or clean-machine compatibility. Downloaded scripts and dependencies can still be restricted by a user's Windows policies; keep protection enabled and report the exact failure.

## Optional native EXE builds

The older native setup builder remains in source for future use. It still requires an approved publisher policy, timestamped trusted signatures, and exact-candidate Windows validation before EXE publication. A SignPath Foundation application was declined for insufficient established public visibility, and no publisher certificate has been obtained. These EXE requirements do not apply to publishing the user-approved `.mjs` setup and do not block that release path.

References: [official Node.js downloads](https://nodejs.org/en/download), [Node.js single executable/signing behavior](https://nodejs.org/download/release/v24.18.0/docs/api/single-executable-applications.html), [Microsoft Smart App Control](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/overview), [Microsoft application and driver control](https://learn.microsoft.com/en-us/windows/security/book/application-security-application-and-driver-control).
