$ErrorActionPreference='Stop'
$sourceRoot=Split-Path $PSScriptRoot -Parent
. (Join-Path $sourceRoot 'scripts\Startup.ps1')
. (Join-Path $sourceRoot 'scripts\HostShortcuts.ps1')
function Assert-Startup($Condition,$Message) { if(-not $Condition) { throw $Message } }
$global:fixturePort=$null
function Get-RbxportUserPort { return $global:fixturePort }
function Set-RbxportUserPort($Value) { $global:fixturePort=$Value }
function Send-RbxportEnvironmentChanged { }
$fixtureRoot=Join-Path ([IO.Path]::GetTempPath()) ('rbxport-startup-'+[Guid]::NewGuid().ToString('N'))
$options=@{StartupDirectory=(Join-Path $fixtureRoot 'Startup');StateDirectory=(Join-Path $fixtureRoot 'Connection');ProgramsDirectory=(Join-Path $fixtureRoot 'Programs');DesktopDirectory=(Join-Path $fixtureRoot 'Desktop');RbxportPath=(Join-Path $fixtureRoot 'rbxport.exe')}
try {
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
    Assert-Startup ($global:fixturePort -eq '43822') 'Ordinary launch needs the connection port'
    Assert-Startup (@(Get-ChildItem -LiteralPath $options.StartupDirectory -Filter '*.lnk').Count -eq 0) 'Neither add-on remains at Windows sign-in'
    Assert-Startup (@(Get-ChildItem -LiteralPath $options.DesktopDirectory -Filter '*.lnk').Count -eq 1) 'Only original rbxport desktop entry remains'
    $link=$shell.CreateShortcut($ordinary)
    Assert-Startup ($link.Arguments.Contains('Start-Rbxport.ps1') -and $link.IconLocation -eq ($options.RbxportPath+',0')) 'Shared shortcut keeps original host icon'
    $syncRoot=Join-Path $fixtureRoot 'Playlist Sync';$wizardRoot=Join-Path $fixtureRoot 'Playlist Wizard'
    Set-RbxportAddonStartup -Root $syncRoot @options
    $state=Get-Content -LiteralPath (Join-Path $options.StateDirectory 'startup.json') -Raw | ConvertFrom-Json
    Assert-Startup ($state.addons.Count -eq 2) 'Enable is idempotent'
    Set-RbxportAddonStartup -Root $syncRoot -Disable @options
    $link=$shell.CreateShortcut($ordinary)
    Assert-Startup ($global:fixturePort -eq '43822' -and $link.Arguments.Contains('Start-Rbxport.ps1')) 'Disable Sync preserves Wizard integration'
    Assert-Startup (Test-Path -LiteralPath (Join-Path $options.StateDirectory 'Start-Rbxport.ps1')) 'Shared launcher survives removing either companion'
    Set-RbxportAddonStartup -Root $wizardRoot -Disable @options
    Assert-Startup (-not $global:fixturePort) 'Last disable restores absent original port'
    Assert-Startup ([Convert]::ToBase64String([IO.File]::ReadAllBytes($ordinary)) -eq $original) 'Restore original shortcut bytes'
    Assert-Startup (-not(Test-Path -LiteralPath (Join-Path $options.DesktopDirectory 'rbxport.lnk'))) 'Remove only newly created wrapper'
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
    Set-RbxportAddonStartup -Root $wizardRoot @options
    $global:fixtureHostRunning=$false;$global:fixtureHostStarts=0;$global:fixtureAddonStarts=@()
    function Get-Process { if($global:fixtureHostRunning) { return @{Id=54321;Path=$options.RbxportPath} } }
    function Start-Process {
        param($FilePath,$ArgumentList,$WindowStyle,[switch]$Wait,[switch]$PassThru)
        if($FilePath -eq $options.RbxportPath) { $global:fixtureHostRunning=$true;$global:fixtureHostStarts++;return @{Id=54321} }
        Assert-Startup (-not $Wait -and $WindowStyle -eq 'Hidden' -and $ArgumentList.Contains('-Background -NoWindow') -and $ArgumentList.Contains('-PauseAutomatic')) 'Wait only for the launcher; never wait for persistent descendants'
        $global:fixtureAddonStarts+=,$ArgumentList
        $child=[pscustomobject]@{ExitCode=0}
        $child | Add-Member -MemberType ScriptMethod -Name WaitForExit -Value { }
        $child | Add-Member -MemberType ScriptMethod -Name Refresh -Value { }
        return $child
    }
    & (Join-Path $options.StateDirectory 'Start-Rbxport.ps1') -NoWindow -PauseAutomatic
    & (Join-Path $options.StateDirectory 'Start-Rbxport.ps1') -NoWindow -PauseAutomatic
    Assert-Startup ($global:fixtureHostStarts -eq 1 -and $global:fixtureAddonStarts.Count -eq 4) 'Repeated shortcuts reuse one host and dispatch both companions'
    $package=(Get-Content -LiteralPath (Join-Path $sourceRoot 'package.json') -Raw | ConvertFrom-Json).name
    $title=if($package -eq 'rbxport-playlist-sync-addon') { 'Sync' } else { 'Wizard' }
    $runtimeRoot=Join-Path $fixtureRoot 'Runtime fixture'
    New-Item -ItemType Directory -Path (Join-Path $runtimeRoot 'scripts'),(Join-Path $runtimeRoot 'data') -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $sourceRoot 'scripts\Desktop.ps1') -Destination (Join-Path $runtimeRoot 'scripts\Desktop.ps1')
    Add-Content -LiteralPath (Join-Path $runtimeRoot 'scripts\Desktop.ps1') -Value ("function Find-Playlist${title}Rbxport { return 'fixture-host.exe' }`nfunction Get-Playlist${title}HostProcess { if(`$global:fixtureHostRunning) { return @{Id=54321} } }`nfunction Test-Playlist${title}ServiceListening { return `$global:fixtureServiceStarted }")
    $launcher=Join-Path $runtimeRoot ('Start-Playlist-'+$title+'.ps1')
    Copy-Item -LiteralPath (Join-Path $sourceRoot ('Start-Playlist-'+$title+'.ps1')) -Destination $launcher
    @{dataDirectory=(Join-Path $runtimeRoot 'data')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimeRoot 'installed.json')
    $port=if($title -eq 'Sync') { 43821 } else { 43823 }
    Set-Content -LiteralPath (Join-Path $runtimeRoot 'data\launch-url.txt') -Value ("http://127.0.0.1:$port/#"+('a'*64))
    function Test-Node { $global:LASTEXITCODE=0;return 'v24.19.0' }
    function Invoke-WebRequest { if(-not $global:fixtureServiceStarted) { throw 'not running' };return @{StatusCode=200} }
    function Start-Process { param($FilePath,$ArgumentList,$WindowStyle,[switch]$PassThru,$RedirectStandardOutput,$RedirectStandardError);Assert-Startup ($FilePath -eq 'Test-Node') 'Only fake service may start';$global:fixtureServiceStarted=$true;$global:fixtureArguments=$ArgumentList;return @{Id=123456} }
    $global:fixtureServiceStarted=$false;$global:fixtureHostRunning=$false
    & $launcher -Background -NoWindow -NodePath Test-Node
    Assert-Startup (-not $global:fixtureServiceStarted) 'Closed host leaves no service'
    $global:fixtureHostRunning=$true
    & $launcher -Background -NoWindow -PauseAutomatic -NodePath Test-Node
    Assert-Startup ($global:fixtureServiceStarted -and $global:fixtureArguments -contains '--host-pid' -and $global:fixtureArguments -contains '54321') 'Service follows exact host process'
    function Invoke-RestMethod { param($Uri,$Headers,$TimeoutSec);$expectedEndpoint=if($title -eq 'Sync') { '/api/state' } else { '/api/panel' };Assert-Startup ($Uri.EndsWith($expectedEndpoint)) 'Use the distribution session endpoint';return @{hostPid=11111} }
    $global:fixtureWaits=0
    function Start-Sleep { param($Milliseconds);$global:fixtureWaits++;$global:fixtureServiceStarted=$false }
    & $launcher -Background -NoWindow -NodePath Test-Node
    Assert-Startup ($global:fixtureWaits -eq 1 -and $global:fixtureServiceStarted) 'Quick reopen waits for previous session'
} finally {
    $resolved=[IO.Path]::GetFullPath($fixtureRoot)
    $tempPrefix=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')+'\'
    Assert-Startup ($resolved.StartsWith($tempPrefix,[StringComparison]::OrdinalIgnoreCase) -and (Split-Path $resolved -Leaf) -match '^rbxport-startup-[a-f0-9]{32}$') 'Unsafe fixture cleanup'
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
foreach($directory in @($sourceRoot,(Join-Path $sourceRoot 'scripts'))) {
    Get-ChildItem -LiteralPath $directory -Filter '*.ps1' | ForEach-Object { $parseErrors=$null;$null=[Management.Automation.Language.Parser]::ParseFile($_.FullName,[ref]$null,[ref]$parseErrors);Assert-Startup (-not $parseErrors) ('PowerShell syntax: '+$_.Name) }
}
Write-Output 'Independent add-on startup checks passed'
