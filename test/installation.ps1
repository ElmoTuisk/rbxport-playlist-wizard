param([string]$NodePath)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
. (Join-Path $repo 'scripts\Installation.ps1')
function Assert-Install($Condition, $Message) { if (-not $Condition) { throw $Message } }
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('playlist-wizard-install-' + [Guid]::NewGuid().ToString('N'))
$source = Join-Path $fixture 'source'
$target = Join-Path $fixture 'installed'
$data = Join-Path $fixture 'saved'
$cache = Join-Path $fixture 'cache'
try {
    foreach ($dir in @($source,$target,$data,$cache)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    # A synthetic setup source and cached, hashed tools; no download, registry, shortcut, host or service access.
    foreach ($dir in @('src','public','scripts','docs')) { New-Item -ItemType Directory -Path (Join-Path $source $dir) | Out-Null; Set-Content -LiteralPath (Join-Path $source "$dir\fixture.txt") 'program fixture' }
    Copy-Item -LiteralPath (Join-Path $repo 'scripts\ReleaseTrust.ps1') -Destination (Join-Path $source 'scripts')
    Copy-Item -LiteralPath (Join-Path $repo 'release-signing.json') -Destination $source
    Set-Content -LiteralPath (Join-Path $source 'scripts\Install-Essentia.mjs') -Value "import fs from 'node:fs';import path from 'node:path';const d=process.argv[process.argv.indexOf('--directory')+1];fs.mkdirSync(d,{recursive:true});for(const f of ['essentia-wasm.cjs','essentia-core.cjs','LICENSE-Essentia.txt'])fs.writeFileSync(path.join(d,f),'fixture');"
    Set-Content -LiteralPath (Join-Path $source 'src\server.mjs') '// synthetic service; never executed'
    foreach ($name in @('README.md','AGENTS.md','CHANGELOG.md','LICENSE','LICENSE-AGPL-3.0.txt','THIRD_PARTY.md','manifest.json','Start-Playlist-Wizard.ps1','Stop-Playlist-Wizard.ps1','Launch-Playlist-Wizard.cmd','Configure-Rbxport-Startup.ps1','Uninstall-Playlist-Wizard.ps1')) { Set-Content -LiteralPath (Join-Path $source $name) 'fixture' }
    Copy-Item -LiteralPath (Join-Path $repo 'Install-Playlist-Wizard.ps1') -Destination $source
    Copy-Item -LiteralPath (Join-Path $repo 'scripts\Installation.ps1') -Destination (Join-Path $source 'scripts')
    Copy-Item -LiteralPath (Join-Path $repo 'scripts\obsolete-program-files.json') -Destination (Join-Path $source 'scripts')
    Copy-Item -LiteralPath (Join-Path $repo 'scripts\RbxportLauncher.cs') -Destination (Join-Path $source 'scripts')
    Set-Content -LiteralPath (Join-Path $source 'scripts\Desktop.ps1') "function Find-PlaylistWizardRbxport { return 'fixture-rbxport.exe' }`nfunction Test-PlaylistWizardServiceListening { return `$false }"
    @{name='rbxport-playlist-wizard-addon';version='0.10.5'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $source 'package.json')
    Copy-Item -LiteralPath $NodePath -Destination (Join-Path $cache 'node.exe')
    Set-Content -LiteralPath (Join-Path $cache 'yt-dlp.exe') 'fake downloader; never executed'
    $bin = Join-Path $fixture 'ffmpeg\bin'; New-Item -ItemType Directory -Path $bin -Force | Out-Null
    foreach ($name in @('ffmpeg.exe','ffprobe.exe')) { Set-Content -LiteralPath (Join-Path $bin $name) 'fake audio tool; never executed' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem,System.IO.Compression
    $zip=[IO.Compression.ZipFile]::Open((Join-Path $cache 'ffmpeg-essentials.zip'),[IO.Compression.ZipArchiveMode]::Create)
    try { foreach($name in @('ffmpeg.exe','ffprobe.exe')) { $null=[IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,(Join-Path $bin $name),('ffmpeg/bin/'+$name)) } } finally { $zip.Dispose() }
    function Hash($Path) { return Get-PlaylistWizardFileHash $Path }
    @{node=@{url='https://nodejs.org/fixture';sha256=(Hash (Join-Path $cache 'node.exe'))};essentia=@{files=@{'essentia-wasm.cjs'=@{};'essentia-core.cjs'=@{};'LICENSE-Essentia.txt'=@{}}};ffmpeg=@{url='https://www.gyan.dev/fixture';sha256=(Hash (Join-Path $cache 'ffmpeg-essentials.zip'));ffmpegSha256=(Hash (Join-Path $bin 'ffmpeg.exe'));ffprobeSha256=(Hash (Join-Path $bin 'ffprobe.exe'))}} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $source 'dependencies.json')
    Set-Content -LiteralPath (Join-Path $data 'wizard.sqlite') 'saved playlist settings'
    $desktopFixture=Join-Path $source 'scripts\Desktop.ps1'
    $desktopSaved=Get-Content -LiteralPath $desktopFixture -Raw
    Set-Content -LiteralPath $desktopFixture -Value $desktopSaved.Replace('return $false','return $true')
    $blockedTarget=Join-Path $fixture 'must-not-exist'
    $blocked=$false;try { & (Join-Path $source 'Install-Playlist-Wizard.ps1') -InstallDirectory $blockedTarget -DataDirectory $data -CacheDirectory $cache -NoShortcuts -NoLaunch -NoRegistry } catch { $blocked=$_.Exception.Message.Contains('Stop the running Playlist Wizard') }
    Assert-Install ($blocked -and -not (Test-Path -LiteralPath $blockedTarget)) 'A running copy must be refused before changing files'
    Set-Content -LiteralPath $desktopFixture -Value $desktopSaved
    $cancelFile=Join-Path $fixture 'cancel.txt'; $statusFile=Join-Path $fixture 'status.txt'
    Set-Content -LiteralPath $cancelFile 'cancel'
    $cancelled=$false
    try { & (Join-Path $source 'Install-Playlist-Wizard.ps1') -InstallDirectory $blockedTarget -CacheDirectory $cache -NoShortcuts -NoLaunch -NoRegistry -CancellationFile $cancelFile -StatusFile $statusFile } catch { $cancelled=$_.Exception -is [OperationCanceledException] }
    Assert-Install ($cancelled -and -not (Test-Path -LiteralPath $blockedTarget)) 'Cancelling before setup must leave the existing installation untouched'
    Assert-Install ((Get-Content -LiteralPath $statusFile -Raw).StartsWith('cancelled')) 'Cancellation must be reported without a raw PowerShell stack'
    & (Join-Path $source 'Install-Playlist-Wizard.ps1') -InstallDirectory $target -DataDirectory $data -CacheDirectory $cache -NoShortcuts -NoLaunch -NoRegistry
    $record = Get-Content -LiteralPath (Join-Path $target 'installed.json') -Raw | ConvertFrom-Json
    Assert-Install ($record.product -eq 'rbxport-playlist-wizard' -and $record.files.Count -gt 10) 'Installation receipt missing'
    # The next update must remove only unchanged files retired by the previous version.
    foreach($name in @('retired.mjs','retired-edited.mjs')) {
        Set-Content -LiteralPath (Join-Path $target ('src\'+$name)) '// retired fixture'
        $record.files+=@{path=('src\'+$name);sha256=(Hash (Join-Path $target ('src\'+$name)))}
    }
    $record | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $target 'installed.json')
    Set-Content -LiteralPath (Join-Path $target 'src\retired-edited.mjs') '// user edit; keep'
    # Upgrade without an explicit data path must preserve the first installation's custom data path.
    & (Join-Path $source 'Install-Playlist-Wizard.ps1') -InstallDirectory $target -CacheDirectory $cache -NoShortcuts -NoLaunch -NoRegistry
    $record = Get-Content -LiteralPath (Join-Path $target 'installed.json') -Raw | ConvertFrom-Json
    Assert-Install ($record.dataDirectory -eq $data) 'Upgrade moved saved data'
    Assert-Install (-not(Test-Path -LiteralPath (Join-Path $target 'src\retired.mjs'))) 'Unchanged obsolete program file remained'
    Assert-Install (Test-Path -LiteralPath (Join-Path $target 'src\retired-edited.mjs')) 'Edited obsolete program file was removed'
    Assert-Install (Test-Path -LiteralPath (Join-Path $target 'src\server.mjs')) 'A current program file was removed'
    # Discover both historical receipts and registered portable copies without touching live registration.
    $legacy = Join-Path $fixture 'portable'
    New-Item -ItemType Directory -Path (Join-Path $legacy 'src'),(Join-Path $legacy '.local-data') -Force | Out-Null
    foreach ($name in @('package.json','Start-Playlist-Wizard.ps1','src\server.mjs')) { Copy-Item -LiteralPath (Join-Path $source $name) -Destination (Join-Path $legacy $name) }
    Set-Content -LiteralPath (Join-Path $legacy '.local-data\wizard.sqlite') 'portable accounts and links'
    $stateFile = Join-Path $fixture 'startup.json'
    @{version=1;addons=@(@{id='Playlist-Wizard';root=$legacy},@{id='Playlist-Sync';root=(Join-Path $fixture 'sync')})} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $stateFile
    $stateHash = Hash $stateFile
    $roots = @(Get-PlaylistWizardRegisteredRoots -StateFile $stateFile -ShortcutPaths @() -NoRegistry)
    Assert-Install ($roots.Count -eq 1 -and $roots[0] -eq $legacy) 'Discovery must select only Wizard registration'
    $shortcutPath = Join-Path $fixture 'Playlist Wizard.lnk'
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $shortcut.Arguments = '-NoProfile -File "' + (Join-Path $legacy 'Start-Playlist-Wizard.ps1') + '"'
    $shortcut.Save()
    $shortcutRoots = @(Get-PlaylistWizardRegisteredRoots -StateFile (Join-Path $fixture 'absent.json') -ShortcutPaths @($shortcutPath) -NoRegistry)
    Assert-Install ($shortcutRoots.Count -eq 1 -and $shortcutRoots[0] -eq $legacy) 'Shortcut discovery lost the existing copy'
    $fresh = Join-Path $fixture 'fresh'
    $selected = Resolve-PlaylistWizardInstall -DefaultRoot $fresh -DefaultData $data -RegisteredRoots $roots
    Assert-Install ($selected.root -eq $legacy -and $selected.dataDirectory -eq (Join-Path $legacy '.local-data')) 'Portable discovery lost its data'
    & (Join-Path $source 'Install-Playlist-Wizard.ps1') -ExistingDirectory $selected.root -CacheDirectory $cache -NoShortcuts -NoLaunch -NoRegistry
    $portableRecord = Get-Content -LiteralPath (Join-Path $legacy 'installed.json') -Raw | ConvertFrom-Json
    Assert-Install ($portableRecord.dataDirectory -eq (Join-Path $legacy '.local-data') -and -not (Test-Path -LiteralPath $fresh)) 'Portable upgrade created a second installation'
    Assert-Install ((Get-Content -LiteralPath (Join-Path $legacy '.local-data\wizard.sqlite') -Raw).Trim() -eq 'portable accounts and links') 'Portable data changed'
    Assert-Install ((Hash $stateFile) -eq $stateHash) 'Discovery changed companion registration'
    $selected = Resolve-PlaylistWizardInstall -DefaultRoot $fresh -DefaultData $data -RegisteredRoots @($legacy,$legacy)
    Assert-Install ($selected.root -eq $legacy) 'Duplicate references must resolve to one copy'
    $blocked=$false; try { Resolve-PlaylistWizardInstall -DefaultRoot $target -DefaultData $data -RegisteredRoots @($legacy) | Out-Null } catch { $blocked=$_.Exception.Message.Contains('More than one') }
    Assert-Install $blocked 'Ambiguous copies must require folder selection'
    $blocked=$false; try { Resolve-PlaylistWizardInstall -DefaultRoot $fresh -DefaultData $data -ExplicitRoot $source -ExplicitData $data | Out-Null } catch { $blocked=$true }
    Assert-Install $blocked 'Updates must not silently change a data folder'
    $blocked=$false; try { Resolve-PlaylistWizardInstall -DefaultRoot $fresh -DefaultData $data -ExplicitRoot $data -RequireExisting | Out-Null } catch { $blocked=$true }
    Assert-Install $blocked 'Folder picker must reject unrelated folders'
    @{dataDirectory=$data;version='0.10.5'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $target 'installed.json')
    $selected = Resolve-PlaylistWizardInstall -DefaultRoot $target -DefaultData (Join-Path $fixture 'wrong-data')
    Assert-Install ($selected.dataDirectory -eq $data) 'Pre-managed setup receipt lost its custom data'
    & (Join-Path $source 'Install-Playlist-Wizard.ps1') -InstallDirectory $target -CacheDirectory $cache -NoShortcuts -NoLaunch -NoRegistry
    $record = Get-Content -LiteralPath (Join-Path $target 'installed.json') -Raw | ConvertFrom-Json
    $packageSaved = Get-Content -LiteralPath (Join-Path $target 'package.json') -Raw
    $packageSaved.Replace('0.10.5','99.0.0') | Set-Content -LiteralPath (Join-Path $target 'package.json')
    $blocked=$false; try { & (Join-Path $source 'Install-Playlist-Wizard.ps1') -InstallDirectory $target -CacheDirectory $cache -NoShortcuts -NoLaunch -NoRegistry } catch { $blocked=$_.Exception.Message.Contains('newer Playlist Wizard') }
    Assert-Install $blocked 'An old EXE must not downgrade a newer installation'
    Set-Content -LiteralPath (Join-Path $target 'package.json') -Value $packageSaved
    Set-Content -LiteralPath (Join-Path $target 'src\fixture.txt') 'user-edited program file'
    New-Item -ItemType Directory -Path (Join-Path $target 'Music') | Out-Null
    Set-Content -LiteralPath (Join-Path $target 'Music\keep.mp3') 'synthetic music sentinel'
    $originalRecord = Get-Content -LiteralPath (Join-Path $target 'installed.json') -Raw
    $record.files += @{path='..\outside.txt';sha256=('a'*64)}
    $record | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $target 'installed.json')
    $rejected=$false;try { $null=Get-PlaylistWizardRemovalPlan $target } catch { $rejected=$true }
    Assert-Install $rejected 'Path traversal must fail before any deletion'
    Assert-Install (Test-Path -LiteralPath (Join-Path $target '.runtime\node.exe')) 'Invalid receipt caused a partial removal'
    Set-Content -LiteralPath (Join-Path $target 'installed.json') -Value $originalRecord
    Remove-PlaylistWizardProgramFiles (Get-PlaylistWizardRemovalPlan $target)
    Assert-Install (-not (Test-Path -LiteralPath (Join-Path $target '.runtime\node.exe'))) 'Owned runtime was not removed'
    Assert-Install (Test-Path -LiteralPath (Join-Path $target 'src\fixture.txt')) 'Modified file was deleted'
    Assert-Install (Test-Path -LiteralPath (Join-Path $target 'Music\keep.mp3')) 'Music was deleted'
    Assert-Install ((Get-Content -LiteralPath (Join-Path $data 'wizard.sqlite') -Raw).Trim() -eq 'saved playlist settings') 'Saved settings were changed'
    # Idle update shutdown is paired and restricted to this exact installation.
    Set-Content -LiteralPath (Join-Path $data 'service.pid') '123456'
    Set-Content -LiteralPath (Join-Path $data 'launch-url.txt') ('http://127.0.0.1:43823/#'+('a'*64))
    $script:fixtureListening=$true;$script:fixtureActive=$true;$script:fixtureConnected=$false;$script:shutdowns=0;$script:wrongProcess=$false
    function Test-PlaylistWizardServiceListening { return $script:fixtureListening }
    function Get-CimInstance { param($ClassName,$Filter); return @{Name=$(if($script:wrongProcess){'other.exe'}else{'node.exe'});CommandLine=('node.exe "'+(Join-Path $target 'src\server.mjs')+'"')} }
    function Get-Process { param($Id,$ErrorAction); return $null }
    function Invoke-RestMethod {
        param($Uri,$Headers,$Method,$ContentType,$Body,$TimeoutSec)
        Assert-Install ($Headers.Authorization -eq ('Bearer '+('a'*64))) 'Shutdown must use the saved local pairing'
        if($Uri -eq 'http://127.0.0.1:43823/api/panel') {return @{wizard=@{active=$script:fixtureActive};connected=$script:fixtureConnected}}
        Assert-Install ($Uri -eq 'http://127.0.0.1:43823/api/shutdown' -and ($Body | ConvertFrom-Json).ifIdle) 'Update shutdown must be idle-only'
        $script:shutdowns++;$script:fixtureListening=$false;return @{ok=$true}
    }
    $blocked=$false;try{Stop-PlaylistWizardForUpdate $target $data}catch{$blocked=$_.Exception.Message.Contains('current Wizard operation')}
    Assert-Install ($blocked -and $script:shutdowns -eq 0) 'Updating must not cancel active music work'
    $script:fixtureActive=$false;$script:fixtureConnected=$true
    $blocked=$false;try{Stop-PlaylistWizardForUpdate $target $data}catch{$blocked=$_.Exception.Message.Contains('Close rbxport')}
    Assert-Install ($blocked -and $script:shutdowns -eq 0) 'Setup must ask for rbxport to close'
    $script:fixtureConnected=$false;$script:wrongProcess=$true
    $blocked=$false;try{Stop-PlaylistWizardForUpdate $target $data}catch{$blocked=$true}
    Assert-Install ($blocked -and $script:shutdowns -eq 0) 'Setup must not stop an unrelated process'
    $script:wrongProcess=$false
    Stop-PlaylistWizardForUpdate $target $data
    Assert-Install ($script:shutdowns -eq 1 -and -not $script:fixtureListening) 'Idle installed copy must stop automatically for the update'
    Write-Output 'Managed installation checks passed'
} finally {
    $full = [IO.Path]::GetFullPath($fixture)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $full.StartsWith($tempRoot,[StringComparison]::OrdinalIgnoreCase) -or (Split-Path $full -Leaf) -notmatch '^playlist-wizard-install-[a-f0-9]{32}$') { throw 'Unsafe fixture cleanup path' }
    if (Test-Path -LiteralPath $full) { Remove-Item -LiteralPath $full -Recurse -Force }
}
