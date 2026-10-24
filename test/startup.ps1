param([Parameter(Mandatory=$true)][string]$NodePath)
$ErrorActionPreference='Stop'
$sourceRoot=Split-Path $PSScriptRoot -Parent
function Assert-Startup($Condition,$Message) { if(-not $Condition) { throw $Message } }
$global:fixturePort=$null
$fixtureRoot=Join-Path ([IO.Path]::GetTempPath()) ('rbxport-startup-'+[Guid]::NewGuid().ToString('N'))
$options=@{StartupDirectory=(Join-Path $fixtureRoot 'Startup');StateDirectory=(Join-Path $fixtureRoot 'Connection');ProgramsDirectory=(Join-Path $fixtureRoot 'Programs');DesktopDirectory=(Join-Path $fixtureRoot 'Desktop');RbxportPath=(Join-Path $fixtureRoot 'rbxport.exe')}
try {
    $helperRoot=Join-Path $fixtureRoot 'helpers'
    New-Item -ItemType Directory -Path (Join-Path $helperRoot 'scripts'),(Join-Path $helperRoot '.runtime') -Force | Out-Null
    foreach($name in @('Startup.ps1','HostShortcuts.ps1','Start-Rbxport.mjs')) { Copy-Item -LiteralPath (Join-Path $sourceRoot ('scripts\'+$name)) -Destination (Join-Path $helperRoot 'scripts') }
    Copy-Item -LiteralPath $NodePath -Destination (Join-Path $helperRoot '.runtime\node.exe')
    . (Join-Path $helperRoot 'scripts\HostShortcuts.ps1')
    $hash=(Get-RbxportShortcutHash $NodePath).ToLowerInvariant()
    @{node=@{url='https://nodejs.org/dist/fixture/node.exe';sha256=$hash}} | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $helperRoot 'dependencies.json')
    . (Join-Path $helperRoot 'scripts\Startup.ps1')
    . (Join-Path $helperRoot 'scripts\HostShortcuts.ps1')
    function Get-RbxportUserPort { return $global:fixturePort }
    function Set-RbxportUserPort($Value) { $global:fixturePort=$Value }
    function Send-RbxportEnvironmentChanged { }
    foreach($directory in @($options.StartupDirectory,$options.ProgramsDirectory,$options.DesktopDirectory)) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
    Set-Content -LiteralPath $options.RbxportPath 'synthetic host; never executed'
    $shell=New-Object -ComObject WScript.Shell
    $ordinary=Join-Path $options.ProgramsDirectory 'rbxport.lnk'
    $link=$shell.CreateShortcut($ordinary);$link.TargetPath=$options.RbxportPath;$link.Save()
    $original=[Convert]::ToBase64String([IO.File]::ReadAllBytes($ordinary))
    foreach($addon in @('Wizard','Sync')) {
        $root=Join-Path $fixtureRoot ('Playlist '+$addon)
        New-Item -ItemType Directory -Path $root -Force | Out-Null
        @{name=('rbxport-playlist-'+$addon.ToLowerInvariant()+'-addon')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root 'package.json')
        Set-Content -LiteralPath (Join-Path $root ('Start-Playlist-'+$addon+'.ps1')) '# fixture'
        $oldLink=$shell.CreateShortcut((Join-Path $options.StartupDirectory ('rbxport-Playlist-'+$addon+'.lnk')))
        $oldLink.TargetPath=Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
        $oldLink.Arguments='-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+(Join-Path $root ('Start-Playlist-'+$addon+'.ps1'))+'" -Background -NoWindow';$oldLink.Save()
        $desktopLink=$shell.CreateShortcut((Join-Path $options.DesktopDirectory ('Playlist '+$addon+'.lnk')))
        $desktopLink.TargetPath=$oldLink.TargetPath;$desktopLink.Arguments='-NoProfile -ExecutionPolicy Bypass -File "'+(Join-Path $root ('Start-Playlist-'+$addon+'.ps1'))+'"';$desktopLink.Save()
        Set-RbxportAddonStartup -Root $root @options
    }
    $sharedNode=Join-Path $options.StateDirectory ('runtime\'+$hash+'\node.exe')
    $sharedScript=Join-Path $options.StateDirectory 'Start-Rbxport.mjs'
    Assert-Startup ($global:fixturePort -eq '43822') 'Ordinary launch needs the connection port'
    Assert-Startup (@(Get-ChildItem -LiteralPath $options.StartupDirectory -Filter '*.lnk').Count -eq 0) 'Neither add-on remains at Windows sign-in'
    Assert-Startup (@(Get-ChildItem -LiteralPath $options.DesktopDirectory -Filter '*.lnk').Count -eq 1) 'Only original rbxport desktop entry remains'
    $link=$shell.CreateShortcut($ordinary)
    Assert-Startup ($link.TargetPath -eq $sharedNode -and $link.Arguments -eq ('"'+$sharedScript+'"') -and $link.WindowStyle -eq 7 -and $link.IconLocation -eq ($options.RbxportPath+',0')) 'Direct official Node shortcut keeps original host icon and minimizes its brief parent console'
    Assert-Startup ((Get-RbxportShortcutHash $sharedNode).ToLowerInvariant() -eq $hash) 'Shared runtime is the original verified Node binary'
    $syncRoot=Join-Path $fixtureRoot 'Playlist Sync';$wizardRoot=Join-Path $fixtureRoot 'Playlist Wizard'
    Set-RbxportAddonStartup -Root $syncRoot @options
    $state=Get-Content -LiteralPath (Join-Path $options.StateDirectory 'startup.json') -Raw | ConvertFrom-Json
    Assert-Startup ($state.addons.Count -eq 2) 'Enable is idempotent'
    $tracking=[IO.File]::ReadAllBytes($ordinary);$tracking[36]=$tracking[36] -bxor 1;[IO.File]::WriteAllBytes($ordinary,$tracking)
    Set-RbxportAddonStartup -Root $syncRoot @options
    Assert-Startup ($shell.CreateShortcut($ordinary).TargetPath -eq $sharedNode) 'Explorer tracking metadata changes do not break updates'
    Set-RbxportAddonStartup -Root $syncRoot -Disable @options
    Assert-Startup ($global:fixturePort -eq '43822' -and $shell.CreateShortcut($ordinary).TargetPath -eq $sharedNode) 'Disable Sync preserves Wizard integration'
    Assert-Startup ((Test-Path -LiteralPath $sharedNode) -and (Test-Path -LiteralPath $sharedScript)) 'Shared runtime and launcher survive removing either companion'
    Set-RbxportAddonStartup -Root $wizardRoot -Disable @options
    Assert-Startup (-not $global:fixturePort) 'Last disable restores absent original port'
    Assert-Startup ([Convert]::ToBase64String([IO.File]::ReadAllBytes($ordinary)) -eq $original) 'Restore original shortcut bytes'
    Assert-Startup (-not(Test-Path -LiteralPath (Join-Path $options.DesktopDirectory 'rbxport.lnk'))) 'Remove only newly created shortcut'
    $global:fixturePort='45678';$rejected=$false
    try { Set-RbxportAddonStartup -Root $syncRoot @options } catch { $rejected=$true }
    Assert-Startup ($rejected -and $global:fixturePort -eq '45678') 'Preserve conflicting user port'
    $global:fixturePort='43822'
    Set-RbxportAddonStartup -Root $syncRoot @options
    Set-RbxportAddonStartup -Root $syncRoot -Disable @options
    Assert-Startup ($global:fixturePort -eq '43822') 'Retain preexisting configured port'
    $global:fixturePort=$null
    Set-RbxportAddonStartup -Root $syncRoot @options
    $global:fixturePort='45678'
    Set-RbxportAddonStartup -Root $syncRoot -Disable @options
    Assert-Startup ($global:fixturePort -eq '45678') 'Retain independently changed port'
    $global:fixturePort=$null
    Set-RbxportAddonStartup -Root $syncRoot @options
    $custom=$shell.CreateShortcut($ordinary);$custom.Description='User modification';$custom.Save()
    $customBytes=[Convert]::ToBase64String([IO.File]::ReadAllBytes($ordinary))
    Set-RbxportAddonStartup -Root $syncRoot -Disable @options
    Assert-Startup ([Convert]::ToBase64String([IO.File]::ReadAllBytes($ordinary)) -eq $customBytes) 'Disable retains modified shortcuts'
    [IO.File]::WriteAllBytes($ordinary,[Convert]::FromBase64String($original))
    $legacy=$shell.CreateShortcut($ordinary);$legacy.Arguments='-NoProfile -File "old-sync.ps1" -HostOnly';$legacy.Save()
    @{schema=1;root=$syncRoot;entries=@(@{path=$ordinary;original=$original;hash=(Get-RbxportShortcutHash $ordinary)})} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $options.StateDirectory 'sync-host-shortcuts.json')
    Set-RbxportAddonStartup -Root $wizardRoot @options
    Set-RbxportAddonStartup -Root $wizardRoot -Disable @options
    Assert-Startup ([Convert]::ToBase64String([IO.File]::ReadAllBytes($ordinary)) -eq $original) 'Migration retains true original bytes'
    Set-RbxportAddonStartup -Root $syncRoot @options
    # Invalid config fails before process inventory: this actual shortcut must never open a live host.
    $diagnostic=$shell.CreateShortcut($ordinary);$diagnostic.Arguments+=' --no-window';$diagnostic.Save()
    @{version=2;hostExecutable=$options.RbxportPath;addons=@()} | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $options.StateDirectory 'startup.json')
    $start=New-Object Diagnostics.ProcessStartInfo
    $start.FileName=$ordinary;$start.UseShellExecute=$true
    $process=[Diagnostics.Process]::Start($start)
    try { Assert-Startup ($process.WaitForExit(10000) -and $process.ExitCode -eq 0) 'Actual shortcut dispatches the JavaScript worker and returns promptly' } finally { $process.Dispose() }
    $statusPath=Join-Path $options.StateDirectory 'launch-status.txt'
    for($attempt=0;$attempt -lt 100;$attempt++) { if((Test-Path -LiteralPath $statusPath) -and (Get-Content -LiteralPath $statusPath -Raw).StartsWith('Failed ')) { break }; Start-Sleep -Milliseconds 50 }
    Assert-Startup ((Get-Content -LiteralPath $statusPath -Raw).StartsWith('Failed ')) 'Actual JavaScript worker retains startup failure status'
    Assert-Startup ((Get-Content -LiteralPath (Join-Path $options.StateDirectory 'launch-error.log') -Raw).Contains('Invalid add-on startup registration')) 'Failure is explained without child output or pairing tokens'
    # Runtime verification failure must preserve shortcuts byte for byte.
    $diagnostic=$shell.CreateShortcut($ordinary);$diagnostic.Arguments='"'+$sharedScript+'"';$diagnostic.Save()
    $before=[Convert]::ToBase64String([IO.File]::ReadAllBytes($ordinary))
    Set-Content -LiteralPath (Join-Path $helperRoot '.runtime\node.exe') 'tampered fixture; never executed'
    $rejected=$false;try { Set-RbxportAddonStartup -Root $syncRoot @options } catch { $rejected=$_.Exception.Message -match 'verification' }
    Assert-Startup ($rejected -and [Convert]::ToBase64String([IO.File]::ReadAllBytes($ordinary)) -eq $before) 'Tampered runtime cannot change shortcut targets'
} finally {
    $resolved=[IO.Path]::GetFullPath($fixtureRoot)
    $tempPrefix=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')+'\'
    Assert-Startup ($resolved.StartsWith($tempPrefix,[StringComparison]::OrdinalIgnoreCase) -and (Split-Path $resolved -Leaf) -match '^rbxport-startup-[a-f0-9]{32}$') 'Unsafe fixture cleanup'
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
foreach($directory in @($sourceRoot,(Join-Path $sourceRoot 'scripts'))) {
    Get-ChildItem -LiteralPath $directory -Filter '*.ps1' | ForEach-Object { $parseErrors=$null;$null=[Management.Automation.Language.Parser]::ParseFile($_.FullName,[ref]$null,[ref]$parseErrors);Assert-Startup (-not $parseErrors) ('PowerShell syntax: '+$_.Name) }
}
Write-Output 'Independent JavaScript add-on startup checks passed'
