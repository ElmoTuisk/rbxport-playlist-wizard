param(
    [string]$InstallDirectory = (Join-Path $env:LOCALAPPDATA 'Programs\rbxport-playlist-wizard'),
    [string]$DataDirectory = (Join-Path $env:LOCALAPPDATA 'rbxport-playlist-wizard'),
    [string]$CacheDirectory = (Join-Path $PSScriptRoot '.install-cache'),
    [switch]$NoShortcuts,
    [switch]$NoLaunch,
    [switch]$StartWithRbxport = $true
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
. (Join-Path $PSScriptRoot 'scripts\Desktop.ps1')
if (-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { throw 'Playlist Wizard supports Windows x64.' }
foreach ($path in @($InstallDirectory, $DataDirectory, $CacheDirectory)) {
    if (-not [IO.Path]::IsPathRooted($path) -or $path.Contains('"')) { throw 'Use absolute paths without quotes.' }
}
$InstallDirectory = [IO.Path]::GetFullPath($InstallDirectory)
$sourceRoot = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\')
if ($InstallDirectory.TrimEnd('\') -eq $sourceRoot -or $InstallDirectory.StartsWith($sourceRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Choose an installation directory outside the setup source.' }
$existingPackage = Join-Path $InstallDirectory 'package.json'
if (Test-Path -LiteralPath $existingPackage) {
    $existingName = (Get-Content -LiteralPath $existingPackage -Raw | ConvertFrom-Json).name
    if ($existingName -ne 'rbxport-playlist-wizard-addon') { throw 'That directory belongs to another application. Choose a separate Playlist Wizard directory.' }
}
$existingRecord=Join-Path $InstallDirectory 'installed.json'
if(Test-Path -LiteralPath $existingRecord) {
    $previousData=(Get-Content -LiteralPath $existingRecord -Raw | ConvertFrom-Json).dataDirectory
    if(-not [IO.Path]::IsPathRooted($previousData)) { throw 'Invalid saved-data location in the existing installation.' }
    if($PSBoundParameters.ContainsKey('DataDirectory') -and [IO.Path]::GetFullPath($DataDirectory) -ne [IO.Path]::GetFullPath($previousData)) { throw 'Updates must retain the existing saved-data location.' }
    $DataDirectory=$previousData
}
if (Test-Path -LiteralPath (Join-Path $DataDirectory 'sync.sqlite')) { throw 'Choose a data directory separate from Playlist Sync.' }
$pidFile = Join-Path $DataDirectory 'service.pid'
if (Test-Path -LiteralPath $pidFile) {
    $serviceInfo = Get-CimInstance Win32_Process -Filter "ProcessId=$([int](Get-Content -LiteralPath $pidFile -Raw))"
    if ($serviceInfo -and $serviceInfo.Name -eq 'node.exe' -and $serviceInfo.CommandLine.Contains((Join-Path $InstallDirectory 'src\server.mjs'))) { throw 'Stop Playlist Wizard before updating it.' }
}
foreach ($path in @($InstallDirectory, $DataDirectory, $CacheDirectory)) { New-Item -ItemType Directory -Force -Path $path | Out-Null }
$dependencies = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'dependencies.json') -Raw | ConvertFrom-Json
function Get-WizardVerifiedDownload {
    param([string]$Url, [string]$Hash, [string]$Filename)
    $uri = [Uri]$Url
    if ($uri.Scheme -ne 'https' -or $uri.Host -notin @('nodejs.org', 'www.gyan.dev') -or $Hash -notmatch '^[a-f0-9]{64}$') { throw 'Unexpected dependency source or checksum.' }
    $destination = Join-Path $CacheDirectory $Filename
    if ((Test-Path -LiteralPath $destination) -and (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -eq $Hash) { return $destination }
    $temporary = "$destination.partial"
    Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $temporary
    if ((Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash -ne $Hash) { throw 'Dependency checksum mismatch. Nothing from this download was executed.' }
    Move-Item -LiteralPath $temporary -Destination $destination -Force
    return $destination
}
$node = Get-WizardVerifiedDownload $dependencies.node.url $dependencies.node.sha256 'node.exe'
$archivePath = Get-WizardVerifiedDownload $dependencies.ffmpeg.url $dependencies.ffmpeg.sha256 'ffmpeg.zip'
$runtime = Join-Path $InstallDirectory '.runtime'
$tools = Join-Path $runtime 'tools'
New-Item -ItemType Directory -Force -Path $tools | Out-Null
Copy-Item -LiteralPath $node -Destination (Join-Path $runtime 'node.exe') -Force
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
try {
    foreach ($tool in @(@('ffmpeg.exe', $dependencies.ffmpeg.ffmpegSha256), @('ffprobe.exe', $dependencies.ffmpeg.ffprobeSha256))) {
        $entries = @($archive.Entries | Where-Object { $_.FullName -match ('/bin/' + [Regex]::Escape($tool[0]) + '$') })
        if ($entries.Count -ne 1) { throw 'Cannot identify the audio tool in the verified archive.' }
        $target = Join-Path $tools $tool[0]
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entries[0], $target, $true)
        if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $tool[1]) { throw 'Extracted audio-tool checksum mismatch.' }
    }
} finally { $archive.Dispose() }
$include = @('src','public','scripts','docs','README.md','CHANGELOG.md','LICENSE','LICENSE-AGPL-3.0.txt','THIRD_PARTY.md','package.json','dependencies.json','Start-Playlist-Wizard.ps1','Stop-Playlist-Wizard.ps1','Launch-Playlist-Wizard.cmd','Configure-Rbxport-Startup.ps1')
foreach ($item in $include) {
    $source = Join-Path $PSScriptRoot $item
    if (Test-Path -LiteralPath $source -PathType Container) {
        $target = Join-Path $InstallDirectory $item
        New-Item -ItemType Directory -Force -Path $target | Out-Null
        Get-ChildItem -LiteralPath $source -Force | Copy-Item -Destination $target -Recurse -Force
    } else { Copy-Item -LiteralPath $source -Destination (Join-Path $InstallDirectory $item) -Force }
}
& (Join-Path $runtime 'node.exe') (Join-Path $InstallDirectory 'scripts\Install-Essentia.mjs') --directory (Join-Path $runtime 'essentia') --archive (Join-Path $CacheDirectory 'essentia.js-0.1.3.tgz')
if ($LASTEXITCODE -ne 0) { throw 'Essentia setup did not complete. Check the verified cache or internet access and run setup again.' }
@{dataDirectory=$DataDirectory;version='0.1.0'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $InstallDirectory 'installed.json') -Encoding UTF8
if (-not $NoShortcuts -and -not $StartWithRbxport) {
    $shell = New-Object -ComObject WScript.Shell
    $menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Playlist Wizard'
    New-Item -ItemType Directory -Force -Path $menu | Out-Null
    foreach ($location in @((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Playlist Wizard.lnk'), (Join-Path $menu 'Playlist Wizard.lnk'))) {
        $shortcut = $shell.CreateShortcut($location)
        $shortcut.TargetPath = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
        $shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $InstallDirectory 'Start-Playlist-Wizard.ps1') + '"'
        $shortcut.WorkingDirectory = $InstallDirectory
        $shortcut.WindowStyle = 7
        $shortcut.Save()
    }
    $stop = $shell.CreateShortcut((Join-Path $menu 'Stop Playlist Wizard.lnk'))
    $stop.TargetPath = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $stop.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $InstallDirectory 'Stop-Playlist-Wizard.ps1') + '"'
    $stop.WindowStyle = 7
    $stop.Save()
}
Write-Output 'Playlist Wizard 0.1.0 installed separately. Playlist Sync settings and music were not changed.'
if ($StartWithRbxport -and -not $NoShortcuts) { & (Join-Path $InstallDirectory 'Configure-Rbxport-Startup.ps1') -NoStart }
if (-not $NoLaunch) {
    if($StartWithRbxport -and -not $NoShortcuts) { & (Join-Path $env:LOCALAPPDATA 'rbxport-addons\Start-Rbxport.ps1') }
    else { & (Join-Path $InstallDirectory 'Start-Playlist-Wizard.ps1') }
}
