# Public release policy. This never changes Windows trust stores or application-control settings.
function Get-RbxportReleasePolicy([string]$Root) {
    $path=Join-Path $Root 'release-signing.json'
    if(-not(Test-Path -LiteralPath $path -PathType Leaf)) { throw 'Trusted signing is not configured. No rbxport shortcuts have been changed.' }
    $policy=Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    if($policy.schema -ne 1 -or $policy.status -ne 'approved' -or @($policy.publisherSubjects).Count -ne 1 -or -not $policy.publisherSubjects[0]) {
        throw 'Trusted signing approval is pending. This development build cannot produce a signed setup release.'
    }
    return $policy
}
function Assert-RbxportTrustedFile([string]$Path,[string]$PublisherSubject) {
    if(-not $PublisherSubject -or -not(Test-Path -LiteralPath $Path -PathType Leaf)) { throw 'A required signed release file is missing.' }
    if((Get-Item -LiteralPath $Path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked release files are not supported.' }
    $signature=Get-AuthenticodeSignature -LiteralPath $Path
    if($signature.Status -ne 'Valid' -or -not $signature.SignerCertificate -or $signature.SignerCertificate.Subject -cne $PublisherSubject -or -not $signature.TimeStamperCertificate) {
        throw ('The trusted, timestamped publisher signature could not be verified: '+[IO.Path]::GetFileName($Path)+'. Download a signed release; Windows protection must stay enabled.')
    }
}
function Assert-RbxportReleaseTrust([string]$Root,[switch]$RequireLauncher,[switch]$Installed) {
    $policy=Get-RbxportReleasePolicy $Root
    $name=(Get-Content -LiteralPath (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json).name
    $addon=switch($name) { 'rbxport-playlist-sync-addon' { 'Playlist-Sync' }; 'rbxport-playlist-wizard-addon' { 'Playlist-Wizard' }; default { throw 'Unknown signed add-on.' } }
    $paths=@(('Start-'+$addon+'.ps1'),('Stop-'+$addon+'.ps1'),('Uninstall-'+$addon+'.ps1'),'Configure-Rbxport-Startup.ps1','scripts\Desktop.ps1','scripts\HostShortcuts.ps1','scripts\Installation.ps1','scripts\ReleaseTrust.ps1','scripts\Startup.ps1')
    if(-not $Installed) {
        $paths+=@(Get-ChildItem -LiteralPath $Root -Filter '*.ps1' -File | ForEach-Object Name)
        $paths+=@(Get-ChildItem -LiteralPath (Join-Path $Root 'scripts') -Filter '*.ps1' -File -Recurse | ForEach-Object { $_.FullName.Substring($Root.TrimEnd('\','/').Length+1) })
    }
    # Legacy installers/packagers in the installed root are retained but never executed by integration.
    # Validate the complete fixed runtime chain, not unrelated user/obsolete scripts in that folder.
    foreach($path in ($paths | Sort-Object -Unique)) { Assert-RbxportTrustedFile (Join-Path $Root $path) $policy.publisherSubjects[0] }
    if($RequireLauncher -and -not(Test-Path -LiteralPath (Join-Path $Root 'scripts\Start-Rbxport.mjs') -PathType Leaf)) { throw 'The JavaScript launcher is missing from the release payload.' }
}
