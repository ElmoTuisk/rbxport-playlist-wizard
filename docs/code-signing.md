# Code signing policy

Trusted publisher signing is **pending**. No certificate or SignPath Foundation approval has been obtained. The interim unsigned releases are not the final startup fix. Keep Smart App Control enabled.

Elmo Tuisk ([ElmoTuisk](https://github.com/ElmoTuisk)) maintains these independent open-source add-ons and is the proposed author, reviewer and release approver. GitHub and signing-service MFA must be verified during onboarding; this document does not attest that account setting. External changes require review. Each production signing request requires maintainer approval against its tested source commit.

The intended experience is one setup EXE per add-on, the existing **rbxport** Desktop and Start Menu shortcuts, and an uninstall action inside each add-on. Installing an add-on announces that it changes those shortcuts and enables rbxport's local automation connection. Uninstalling removes that add-on's own registration and matching program files, preserves saved data/music and leaves the companion working. Removing the last registration restores unchanged original shortcuts. Windows chooses Search ranking; we can provide one correct entry but cannot guarantee a ranking on every machine.

## Signing and publication

`release-signing.json` deliberately has pending status and no approved publisher. Production integration refuses to change shortcuts in that state. After provider verification, review the exact certificate subject into that policy; never substitute a self-signed certificate, install a trust root or change Windows application-control settings.

The two repositories use the same staged process:

1. Pass the Node 24 suites on Windows and Linux. A matching version tag is required.
2. `Build-ReleasePayload.ps1` creates an **unsigned signing input**, compiling the public launcher source on the build server. It is not an end-user download and is not executed during this build.
3. The configured signing provider signs our launcher and all distributed root/scripts PowerShell files, with timestamps. Upstream runtime/tools keep their original integrity checks and are never re-signed as our own software. Source archives contain no runtime binaries.
4. `Build-Installer.ps1 -PayloadDirectory <signed-input>` verifies the approved Windows publisher signatures before embedding the payload. It builds the outer setup, which is signed in a second request. No launcher is compiled on the user's computer.
5. Verify the final setup's signature and embedded payload. Compute SHA-256 checksums **after** signing. Retain the signed candidate as a workflow artifact.
6. Download that exact candidate onto a Windows machine with Smart App Control **On**. Record its SHA-256 and the checks below. Set the `verified-windows-release` environment's `SAC_VALIDATED_SETUP_SHA256` variable to that exact hash only after success. Only then approve/re-run publication. A newly signed build with a different hash needs a new check.

The `code-signing` environment needs `SIGNPATH_ORGANIZATION`, `SIGNPATH_PROJECT`, `SIGNPATH_POLICY`, `SIGNPATH_PAYLOAD_CONFIGURATION`, `SIGNPATH_SETUP_CONFIGURATION` and the secret `SIGNPATH_API_TOKEN`. Both environments must have maintainer approval protection configured in GitHub; creating a name in YAML alone does not enable that protection. Configure the provider's GitHub provenance checks, metadata restrictions and manual signing approval too. The provider action is pinned to its reviewed v2 commit. XML files under `installer/` are onboarding templates, not approved provider configurations.

The workflow fails without approved identity/configuration and never uploads unsigned EXEs to GitHub Releases. The source ZIP, signed setup EXE and final checksums remain the release assets. Signature validity and passing CI alone do not establish Smart App Control compatibility or SmartScreen reputation.

## Required exact-candidate Windows check

Use fixture data and no music jobs. Record Windows/host versions, Smart App Control state, setup hash, publisher/signature results and each result in the validation record. Do not save pairing tokens or private paths in public evidence.

- Install Sync alone, Wizard alone and both in each order. Preserve the original rbxport name/icon and one correct Start Menu entry; leave customized shortcuts untouched.
- Open both original shortcuts, close/reopen during startup and after readiness, and repeat. Both enabled buttons must return on the same host process; closing that host must stop both services. No delayed surprise reopen.
- Update legacy and current installations, including a custom data folder. Keep the existing folder, settings and data. Active work and unrelated service processes must block updates.
- Uninstall each add-on from its popup while keeping the other working, then uninstall the last and check original shortcut restoration. Verify data/music sentinels, unknown/edited files and settings remain. Repeat via Windows Installed apps.
- Confirm downloaded Node/audio tools can run with protection enabled. Signing our own code is not proof that every upstream binary is allowed.

## Privacy

The add-ons use a paired loopback connection to the user's rbxport and store their own settings locally. Setup downloads the documented, checksum-pinned runtimes/tools. Playlist Sync contacts the sources/accounts the user configures and uses for playlist work; saved automatic-sync choices can initiate later checks while it runs. Wizard analysis is local. See the READMEs and third-party notices for providers and runtime licensing. No signing telemetry, music or pairing data is sent to the signing provider; signing requests contain public project build artifacts and build provenance.

## Provider status and references

For an individual based in Estonia, Microsoft's public-trust Artifact Signing currently does not support onboarding; individuals are limited to the USA and Canada. SignPath Foundation is a possible free open-source route, subject to its eligibility/reputation review. Its certificate would name **SignPath Foundation** as Windows publisher, while Elmo remains the maintainer. These are new projects; approval must not be assumed. A certificate under Elmo's own legal name instead requires an eligible commercial CA and a separate user-approved purchase/identity check.

References: [Microsoft eligibility](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart), [Smart App Control signing](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/code-signing-for-smart-app-control), [SignPath Foundation conditions](https://signpath.org/terms), [GitHub integration](https://docs.signpath.io/trusted-build-systems/github), [artifact configuration](https://docs.signpath.io/artifact-configuration/reference).
