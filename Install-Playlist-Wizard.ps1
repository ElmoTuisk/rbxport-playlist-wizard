param(
    [string]$InstallDirectory = (Join-Path $env:LOCALAPPDATA 'Programs\rbxport-playlist-wizard'),
    [string]$DataDirectory = (Join-Path $env:LOCALAPPDATA 'rbxport-playlist-wizard'),
    [string]$CacheDirectory = (Join-Path $PSScriptRoot '.install-cache'),
    [string]$ShortcutRoot,
    [string]$ExistingDirectory,
    [string]$StatusFile,
    [string]$CancellationFile,
    [switch]$NoShortcuts,
    [switch]$NoLaunch,
    [switch]$StartWithRbxport,
    [switch]$Offline,
    [switch]$NoRegistry
)
$ErrorActionPreference = 'Stop'
function Set-SetupStatus([string]$State,[string]$Message) {
    if($StatusFile) { [IO.File]::WriteAllText($StatusFile,($State+"`n"+$Message),(New-Object Text.UTF8Encoding($false))) }
    Write-Host $Message
}
function Test-SetupCancellation {
    if($CancellationFile -and (Test-Path -LiteralPath $CancellationFile)) { throw [OperationCanceledException]::new('Setup cancelled. Your existing installation and saved data were kept.') }
}
try {
Test-SetupCancellation
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
. (Join-Path $PSScriptRoot 'scripts\Desktop.ps1')
. (Join-Path $PSScriptRoot 'scripts\Installation.ps1')
. (Join-Path $PSScriptRoot 'scripts\ReleaseTrust.ps1')
# JavaScript startup uses the verified official Node runtime installed below.
# Signed release setup validation remains in the packaging/publication pipeline.
$version = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'package.json') -Raw | ConvertFrom-Json).version
$selection = @{DefaultRoot=$InstallDirectory;DefaultData=$DataDirectory}
if ($ExistingDirectory) { $selection.ExplicitRoot=$ExistingDirectory; $selection.RequireExisting=$true }
elseif ($PSBoundParameters.ContainsKey('InstallDirectory')) { $selection.ExplicitRoot=$InstallDirectory }
else { $selection.RegisteredRoots=@(Get-PlaylistWizardRegisteredRoots -NoRegistry:$NoRegistry) }
if ($PSBoundParameters.ContainsKey('DataDirectory')) { $selection.ExplicitData=$DataDirectory }
$selected = Resolve-PlaylistWizardInstall @selection
$InstallDirectory = $selected.root
$DataDirectory = $selected.dataDirectory
if ($selected.version -and [Version]$selected.version -gt [Version]$version) { throw 'A newer Playlist Wizard version is already installed. Download the latest setup to update it.' }
if(Test-Path -LiteralPath (Join-Path $DataDirectory 'sync.sqlite')) { throw 'Choose a data directory separate from Playlist Sync.' }
Stop-PlaylistWizardForUpdate $InstallDirectory $DataDirectory
if ($selected.version) { Write-Host "Updating Playlist Wizard $($selected.version) in $InstallDirectory. Keeping the existing saved-data folder." }
if (-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { throw 'This installer supports Windows x64. ARM64 is not yet supported.' }
$null = Find-PlaylistWizardRbxport
foreach ($path in @($InstallDirectory, $DataDirectory, $CacheDirectory)) {
    if (-not [IO.Path]::IsPathRooted($path)) { throw 'Installation, data and cache paths must be absolute.' }
    $null = Assert-PlaylistWizardPlainPath $path
    New-Item -ItemType Directory -Force -Path $path | Out-Null
}
$InstallDirectory = [IO.Path]::GetFullPath($InstallDirectory)
if ($InstallDirectory.TrimEnd('\') -eq $PSScriptRoot.TrimEnd('\')) { throw 'Choose an installation folder separate from the downloaded setup folder.' }
$servicePid = Join-Path $DataDirectory 'service.pid'
if (Test-Path -LiteralPath $servicePid) {
    $serviceInfo = Get-CimInstance Win32_Process -Filter "ProcessId=$([int](Get-Content -LiteralPath $servicePid -Raw))"
    if ($serviceInfo -and $serviceInfo.Name -eq 'node.exe' -and $serviceInfo.CommandLine.Contains((Join-Path $InstallDirectory 'src\server.mjs'))) { throw 'Stop Playlist Wizard before installing an update. Your saved data will be kept.' }
}
$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'dependencies.json') -Raw | ConvertFrom-Json
function Get-VerifiedDownload {
    param([string]$Url, [string]$Hash, [string]$Filename)
    $uri = [Uri]$Url
    if ($uri.Scheme -ne 'https' -or $uri.Host -notin @('nodejs.org', 'github.com', 'www.gyan.dev')) { throw 'Unexpected download source' }
    if ($Hash -notmatch '^[a-f0-9]{64}$') { throw 'Invalid dependency checksum' }
    $destination = Join-Path $CacheDirectory $Filename
    if ((Test-Path -LiteralPath $destination) -and (Get-PlaylistWizardFileHash $destination) -eq $Hash) { return $destination }
    if($Offline) { throw "Verified cached dependency is unavailable: $Filename. Offline setup will not download it." }
    $temporary = "$destination.partial"
    Test-SetupCancellation
    Set-SetupStatus 'working' "Downloading $Filename ..."
    $client = New-Object Net.WebClient
    try {
        $download=$client.DownloadFileTaskAsync($Url,$temporary)
        $deadline=[DateTime]::UtcNow.AddMinutes(10)
        while(-not $download.IsCompleted) {
            if($CancellationFile -and (Test-Path -LiteralPath $CancellationFile)) { $client.CancelAsync(); Test-SetupCancellation }
            if([DateTime]::UtcNow -gt $deadline) { $client.CancelAsync(); throw 'Download timed out. Check your connection and retry setup.' }
            Start-Sleep -Milliseconds 100
        }
        $download.GetAwaiter().GetResult()
    } finally { $client.Dispose() }
    if ((Get-PlaylistWizardFileHash $temporary) -ne $Hash) { throw "Checksum verification failed for $Filename. Nothing from this download will be executed." }
    Move-Item -LiteralPath $temporary -Destination $destination -Force
    return $destination
}
Set-SetupStatus 'working' "Preparing Playlist Wizard $version ..."
$nodeDownload = Get-VerifiedDownload $manifest.node.url $manifest.node.sha256 'node.exe'
$ffmpegDownload = Get-VerifiedDownload $manifest.ffmpeg.url $manifest.ffmpeg.sha256 'ffmpeg-essentials.zip'
Test-SetupCancellation
Set-SetupStatus 'installing' 'Installing verified files. Closing setup will finish this step safely.'
$runtime = Join-Path $InstallDirectory '.runtime'
$tools = Join-Path $runtime 'tools'
$include = @('src', 'public', 'scripts', 'docs', 'README.md', 'AGENTS.md', 'CHANGELOG.md', 'LICENSE', 'LICENSE-AGPL-3.0.txt', 'THIRD_PARTY.md', 'package.json', 'dependencies.json', 'Start-Playlist-Wizard.ps1', 'Stop-Playlist-Wizard.ps1', 'Launch-Playlist-Wizard.cmd', 'Configure-Rbxport-Startup.ps1', 'Uninstall-Playlist-Wizard.ps1')
$include += 'release-signing.json'
$ownedFiles = @('.runtime\node.exe','.runtime\tools\ffmpeg.exe','.runtime\tools\ffprobe.exe')
$ownedFiles+=@($manifest.essentia.files.PSObject.Properties | ForEach-Object { '.runtime\essentia\'+$_.Name })
foreach ($item in $include) {
    $source = Join-Path $PSScriptRoot $item
    if ((Get-Item -LiteralPath $source).PSIsContainer) {
        $ownedFiles += @(Get-ChildItem -LiteralPath $source -Recurse -File -Force | ForEach-Object { $_.FullName.Substring($PSScriptRoot.Length + 1) })
    } else { $ownedFiles += $item }
}
$obsoleteFiles=@(Get-PlaylistWizardObsoleteFiles -Root $InstallDirectory -KeepFiles $ownedFiles -DataDirectory $DataDirectory)
# Reject linked program destinations before overwriting any existing file.
foreach ($relative in $ownedFiles) { $null = Get-PlaylistWizardOwnedFile $InstallDirectory $relative }
New-Item -ItemType Directory -Force -Path $tools | Out-Null
$installedNode=Join-Path $runtime 'node.exe'
if(-not(Test-Path -LiteralPath $installedNode) -or (Get-PlaylistWizardFileHash $installedNode) -ne $manifest.node.sha256) {
    Copy-Item -LiteralPath $nodeDownload -Destination $installedNode -Force
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($ffmpegDownload)
try {
    foreach ($item in @(@('ffmpeg.exe', $manifest.ffmpeg.ffmpegSha256), @('ffprobe.exe', $manifest.ffmpeg.ffprobeSha256))) {
        $entries = @($archive.Entries | Where-Object { $_.FullName -match ('/bin/' + [Regex]::Escape($item[0]) + '$') })
        if ($entries.Count -ne 1) { throw "Cannot identify $($item[0]) in the verified FFmpeg archive" }
        $destination = Join-Path $tools $item[0]
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entries[0], $destination, $true)
        if ((Get-PlaylistWizardFileHash $destination) -ne $item[1]) { throw "Extracted checksum failed: $($item[0])" }
    }
} finally { $archive.Dispose() }
foreach ($item in $include) {
    $source = Join-Path $PSScriptRoot $item
    if ((Get-Item -LiteralPath $source).PSIsContainer) {
        $target = Join-Path $InstallDirectory $item
        New-Item -ItemType Directory -Force -Path $target | Out-Null
        Get-ChildItem -LiteralPath $source -Force | Copy-Item -Destination $target -Recurse -Force
    } else { Copy-Item -LiteralPath $source -Destination $InstallDirectory -Force }
}
$essentiaArgs=@((Join-Path $InstallDirectory 'scripts\Install-Essentia.mjs'),'--directory',(Join-Path $runtime 'essentia'),'--archive',(Join-Path $CacheDirectory 'essentia.js-0.1.3.tgz'))
if($Offline) { $essentiaArgs+='--offline' }
& (Join-Path $runtime 'node.exe') @essentiaArgs
if($LASTEXITCODE -ne 0) { throw 'Essentia setup did not complete. Run setup again; your saved data was kept.' }
$ownedShortcuts = @()
& (Join-Path $runtime 'node.exe') --version
if ($LASTEXITCODE -ne 0) { throw 'The private runtime did not start.' }
Remove-PlaylistWizardObsoleteFiles $obsoleteFiles
if (-not $NoShortcuts -and -not $StartWithRbxport) {
    $shell = New-Object -ComObject WScript.Shell
    $menuDirectory = if ($ShortcutRoot) { Join-Path $ShortcutRoot 'Start Menu\Playlist Wizard' } else { Join-Path ([Environment]::GetFolderPath('Programs')) 'Playlist Wizard' }
    $desktopDirectory = if ($ShortcutRoot) { Join-Path $ShortcutRoot 'Desktop' } else { [Environment]::GetFolderPath('Desktop') }
    New-Item -ItemType Directory -Force -Path $menuDirectory | Out-Null
    New-Item -ItemType Directory -Force -Path $desktopDirectory | Out-Null
    $shortcutPaths = @((Join-Path $menuDirectory 'Playlist Wizard.lnk'), (Join-Path $desktopDirectory 'Playlist Wizard.lnk'))
    foreach ($shortcutPath in $shortcutPaths) {
        $shortcut = $shell.CreateShortcut($shortcutPath)
        $shortcut.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
        $shortcut.Arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $InstallDirectory 'Start-Playlist-Wizard.ps1') + '"'
        $shortcut.WorkingDirectory = $InstallDirectory
        $shortcut.Description = 'Open Playlist Wizard for rbxport'
        $shortcut.IconLocation = (Find-PlaylistWizardRbxport) + ',0'
        $shortcut.Save()
        $ownedShortcuts += $shortcutPath
    }
    $stopPath=Join-Path $menuDirectory 'Stop Playlist Wizard.lnk'
    if(Test-Path -LiteralPath $stopPath) {
        $stop=$shell.CreateShortcut($stopPath)
        if($stop.Arguments.Contains('"'+(Join-Path $InstallDirectory 'Stop-Playlist-Wizard.ps1')+'"')) { Remove-Item -LiteralPath $stopPath }
    }
}
Write-PlaylistWizardInstallRecord -Root $InstallDirectory -DataDirectory $DataDirectory -Version $version -Files $ownedFiles -Shortcuts $ownedShortcuts -NoRegistry:$NoRegistry
Write-Host "Installed successfully in $InstallDirectory. Open the Playlist Wizard shortcut whenever you need it."
if ($StartWithRbxport) { & (Join-Path $InstallDirectory 'Configure-Rbxport-Startup.ps1') -NoStart }
if (-not $NoLaunch) {
    if($StartWithRbxport) {
        . (Join-Path $InstallDirectory 'scripts\HostShortcuts.ps1')
        $javascript=Initialize-RbxportJavaScriptLauncher (Join-Path $env:LOCALAPPDATA 'rbxport-addons')
        Start-Process -FilePath $javascript.executable -ArgumentList $javascript.arguments -WindowStyle Hidden
    }
    else {
        $launcher=Join-Path $InstallDirectory 'Start-Playlist-Wizard.ps1'
        Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -WindowStyle Hidden -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $launcher + '"'))
    }
}
Set-SetupStatus 'complete' 'Installed. Playlist Wizard will start and close with rbxport.'
} catch {
    $state=if($_.Exception -is [OperationCanceledException]) { 'cancelled' } else { 'error' }
    Set-SetupStatus $state $_.Exception.Message
    throw
}
