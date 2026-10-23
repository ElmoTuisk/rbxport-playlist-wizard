param([Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference='Stop'
$package=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'package.json') -Raw | ConvertFrom-Json
$version=$package.version
$title=switch($package.name) { 'rbxport-playlist-sync-addon' { 'Playlist Sync' }; 'rbxport-playlist-wizard-addon' { 'Playlist Wizard' }; default { throw 'Unknown add-on.' } }
if($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid package version.' }
$Destination=[IO.Path]::GetFullPath($Destination)
if(Test-Path -LiteralPath $Destination) { throw 'Choose a new, empty staging directory.' }
$compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if(-not(Test-Path -LiteralPath $compiler)) { throw 'Build on Windows x64 with .NET Framework installed.' }
$temporary=Join-Path ([IO.Path]::GetTempPath()) ('rbxport-payload-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporary | Out-Null
try {
    $archive=Join-Path $temporary 'source.zip'
    & (Join-Path $PSScriptRoot 'Package-Addon.ps1') -Destination $archive
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory($archive,$Destination)
    $release=Join-Path $Destination 'release'
    New-Item -ItemType Directory -Path $release | Out-Null
    $metadata=Join-Path $temporary 'Version.cs'
    ('using System.Reflection; [assembly:AssemblyVersion("'+$version+'.0")] [assembly:AssemblyFileVersion("'+$version+'.0")] [assembly:AssemblyProduct("'+$title+' for rbxport")] [assembly:AssemblyCompany("Elmo Tuisk")] [assembly:AssemblyTitle("rbxport add-on launcher")]') | Set-Content -LiteralPath $metadata -Encoding UTF8
    & $compiler /nologo /target:winexe /platform:x64 /optimize+ ('/out:'+(Join-Path $release 'Start-Rbxport.exe')) /reference:System.Windows.Forms.dll (Join-Path $PSScriptRoot 'scripts\RbxportLauncher.cs') $metadata
    if($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed.' }
    Write-Output 'Created UNSIGNED signing input. Do not install or distribute it as a release.'
} finally {
    $full=[IO.Path]::GetFullPath($temporary)
    $temp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')+'\'
    if(-not $full.StartsWith($temp,[StringComparison]::OrdinalIgnoreCase) -or (Split-Path $full -Leaf) -notmatch '^rbxport-payload-[a-f0-9]{32}$') { throw 'Unsafe staging cleanup path.' }
    Remove-Item -LiteralPath $full -Recurse -Force
}
