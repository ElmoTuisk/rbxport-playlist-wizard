$ErrorActionPreference='Stop'
$repo=Split-Path $PSScriptRoot -Parent
$fixture=Join-Path ([IO.Path]::GetTempPath()) ('rbxport-release-build-'+[Guid]::NewGuid().ToString('N'))
try {
    New-Item -ItemType Directory -Path $fixture | Out-Null
    $stage=Join-Path $fixture 'unsigned-payload'
    & (Join-Path $repo 'Build-ReleasePayload.ps1') -Destination $stage
    $package=Get-Content -LiteralPath (Join-Path $repo 'package.json') -Raw | ConvertFrom-Json
    $title=if($package.name -eq 'rbxport-playlist-sync-addon') { 'Playlist Sync' } else { 'Playlist Wizard' }
    if(Test-Path -LiteralPath (Join-Path $stage 'release\Start-Rbxport.exe')) { throw 'Staging must not build a custom startup EXE.' }
    $javascript='scripts\Start-Rbxport.mjs'
    if([Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $repo $javascript))) -cne [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $stage $javascript)))) { throw 'Staging changed JavaScript launcher bytes.' }
    $entry='Install-'+$title.Replace(' ','-')+'.ps1'
    if([Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $repo $entry))) -cne [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $stage $entry)))) { throw 'Staging changed program script bytes.' }
    $output=Join-Path $fixture 'must-not-publish.exe'
    $rejected=$false
    try { & (Join-Path $repo 'Build-Installer.ps1') -PayloadDirectory $stage -Destination $output } catch { $rejected=$_.Exception.Message -match 'pending|signature' }
    if(-not $rejected -or (Test-Path -LiteralPath $output)) { throw 'Unsigned staging input must never become an installer.' }
    foreach($name in @('signpath-payload.xml','signpath-setup.xml')) { $null=[xml](Get-Content -LiteralPath (Join-Path $repo ('installer\'+$name)) -Raw) }
    Write-Output 'Release staging and unsigned publication refusal checks passed'
} finally {
    $full=[IO.Path]::GetFullPath($fixture)
    $temp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')+'\'
    if(-not $full.StartsWith($temp,[StringComparison]::OrdinalIgnoreCase) -or (Split-Path $full -Leaf) -notmatch '^rbxport-release-build-[a-f0-9]{32}$') { throw 'Unsafe build fixture cleanup' }
    Remove-Item -LiteralPath $full -Recurse -Force
}
