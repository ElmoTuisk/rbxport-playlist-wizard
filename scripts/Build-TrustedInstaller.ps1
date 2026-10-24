param([string]$Destination,[Parameter(Mandatory=$true)][string]$PayloadDirectory)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
. (Join-Path $PSScriptRoot 'ReleaseTrust.ps1')
$package=Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$version=$package.version
$title=switch($package.name) { 'rbxport-playlist-sync-addon' { 'Playlist Sync' }; 'rbxport-playlist-wizard-addon' { 'Playlist Wizard' }; default { throw 'Unknown add-on.' } }
$slug=$title.ToLowerInvariant().Replace(' ','-')
$entryPoint='Install-'+$title.Replace(' ','-')+'.ps1'
if($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid package version.' }
$PayloadDirectory=[IO.Path]::GetFullPath($PayloadDirectory)
$payloadPackage=Get-Content -LiteralPath (Join-Path $PayloadDirectory 'package.json') -Raw | ConvertFrom-Json
if($payloadPackage.name -ne $package.name -or $payloadPackage.version -ne $version) { throw 'Signed payload must match the tested product/version.' }
$approved=Get-RbxportReleasePolicy $root
if((Get-FileHash -LiteralPath (Join-Path $root 'release-signing.json') -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath (Join-Path $PayloadDirectory 'release-signing.json') -Algorithm SHA256).Hash) { throw 'The payload publisher policy differs from the tested source.' }
Assert-RbxportReleaseTrust -Root $PayloadDirectory -RequireLauncher
if(-not $Destination) { $Destination=Join-Path $root "dist\$slug-$version-windows-setup.exe" }
$Destination=[IO.Path]::GetFullPath($Destination)
if(Test-Path -LiteralPath $Destination) { throw 'Choose a new output path.' }
$compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if(-not(Test-Path -LiteralPath $compiler)) { throw 'Build on Windows x64 with .NET Framework installed.' }
$temporary=Join-Path ([IO.Path]::GetTempPath()) ('rbxport-installer-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporary | Out-Null
try {
    $payload=Join-Path $temporary 'payload.zip'
    $paths=@(Get-ChildItem -LiteralPath $PayloadDirectory -Force | ForEach-Object FullName)
    Compress-Archive -LiteralPath $paths -DestinationPath $payload
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive=[IO.Compression.ZipFile]::OpenRead($payload)
    try {
        $hasEntry=$false;$hasLauncher=$false
        foreach($entry in $archive.Entries) {
            $name=$entry.FullName.Replace('\','/')
            if($name -eq $entryPoint) { $hasEntry=$true }
            if($name -eq 'scripts/Start-Rbxport.mjs') { $hasLauncher=$true }
            if($name -match '(?i)(\.local-data|\.tools|\.runtime|\.sqlite|\.dpapi|launch-url|cookies|installed\.json|LOCAL_WORKSPACE|\.(mp3|m4a|flac|opus|wav|exe|dll|log)$)' -or $name -match '(^|/)\.\.(/|$)') { throw 'Private or unexpected executable payload entry refused.' }
        }
        if(-not $hasEntry -or -not $hasLauncher) { throw 'Signed installer payload is incomplete.' }
    } finally { $archive.Dispose() }
    $hash=(Get-FileHash -LiteralPath $payload -Algorithm SHA256).Hash.ToLowerInvariant()
    $metadata=Join-Path $temporary 'Version.cs'
    ('using System.Reflection; [assembly:AssemblyVersion("'+$version+'.0")] [assembly:AssemblyFileVersion("'+$version+'.0")] [assembly:AssemblyProduct("'+$title+' for rbxport")] [assembly:AssemblyCompany("Elmo Tuisk")] [assembly:AssemblyTitle("'+$title+' setup")] internal static class Build { internal const string PayloadHash="'+$hash+'"; internal const string Version="'+$version+'"; }') | Set-Content -LiteralPath $metadata -Encoding UTF8
    New-Item -ItemType Directory -Path (Split-Path $Destination -Parent) -Force | Out-Null
    & $compiler /nologo /target:winexe /platform:x64 /optimize+ ('/out:'+$Destination) /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll ('/resource:'+$payload+',Payload.zip') (Join-Path $root 'installer\Setup.cs') $metadata
    if($LASTEXITCODE -ne 0) { throw 'Installer compilation failed.' }
    # Only the final signed EXE may be executed/published. This output is signing input.
    Write-Output 'Created UNSIGNED outer setup with signed payload. Sign and verify it before publication.'
} finally {
    $full=[IO.Path]::GetFullPath($temporary)
    $temp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')+'\'
    if(-not $full.StartsWith($temp,[StringComparison]::OrdinalIgnoreCase) -or (Split-Path $full -Leaf) -notmatch '^rbxport-installer-[a-f0-9]{32}$') { throw 'Unsafe build cleanup path.' }
    Remove-Item -LiteralPath $full -Recurse -Force
}
