# Shared connection setup only. Each add-on keeps its own process and saved data.
function Get-RbxportUserPort { return [Environment]::GetEnvironmentVariable('RBXPORT_DEVTOOLS_PORT', 'User') }
function Set-RbxportUserPort($Value) { [Environment]::SetEnvironmentVariable('RBXPORT_DEVTOOLS_PORT', $Value, 'User') }
function Send-RbxportEnvironmentChanged {
    if (-not ('RbxportEnvironmentNotice' -as [type])) {
        Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class RbxportEnvironmentNotice {
    [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern IntPtr SendMessageTimeout(IntPtr window, uint message, UIntPtr wparam,
        string lparam, uint flags, uint timeout, out UIntPtr result);
}

'@
    }
    $noticeResult = [UIntPtr]::Zero
    $null = [RbxportEnvironmentNotice]::SendMessageTimeout([IntPtr]0xffff, 0x001a, [UIntPtr]::Zero, 'Environment', 2, 3000, [ref]$noticeResult)
}


function Set-RbxportAddonStartup {
    param([Parameter(Mandatory=$true)][string]$Root,[switch]$Disable,
        [string]$StartupDirectory=[Environment]::GetFolderPath('Startup'),
        [string]$StateDirectory=(Join-Path $env:LOCALAPPDATA 'rbxport-addons'),
        [string]$ProgramsDirectory=[Environment]::GetFolderPath('Programs'),
        [string]$DesktopDirectory=[Environment]::GetFolderPath('Desktop'),[string]$RbxportPath)
    . (Join-Path $PSScriptRoot 'HostShortcuts.ps1')
    $Root=Assert-RbxportIntegrationPath $Root
    $null=Assert-RbxportIntegrationPath $StateDirectory
    $name=(Get-Content -LiteralPath (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json).name
    $addon=switch($name) { 'rbxport-playlist-sync-addon' { 'Playlist-Sync' }; 'rbxport-playlist-wizard-addon' { 'Playlist-Wizard' }; default { throw 'Unknown rbxport add-on. Startup was not changed.' } }
    if(-not(Test-Path -LiteralPath (Join-Path $Root ('Start-'+$addon+'.ps1')))) { throw 'Invalid installed launcher.' }
    $statePath=Join-Path $StateDirectory 'startup.json'
    $mutex=New-Object Threading.Mutex($false, 'Local\rbxport-addons-startup')
    $locked=$false
    try {
        $locked=$mutex.WaitOne(10000)
        if(-not $locked) { throw 'Another add-on is configuring startup. Try again shortly.' }
        $saved=if(Test-Path -LiteralPath $statePath) { Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json } else { $null }
        $previous=if($saved) { $saved.previousPort } else { Get-RbxportUserPort }
        $registrations=@($saved.addons | Where-Object { $_ -and $_.id -ne $addon })
        if(-not $Disable) {
            if((Get-RbxportUserPort) -and (Get-RbxportUserPort) -ne '43822') { throw 'rbxport already uses another automation port. Startup was not changed.' }
            $registrations += [pscustomobject]@{id=$addon;root=$Root}
        }
        $hostExecutable=$saved.hostExecutable
        if($registrations.Count) {
            if($RbxportPath) { $hostExecutable=$RbxportPath }
            elseif(-not $hostExecutable -or -not(Test-Path -LiteralPath $hostExecutable -PathType Leaf)) {
                . (Join-Path $PSScriptRoot 'Desktop.ps1')
                $hostExecutable=if($name -eq 'rbxport-playlist-sync-addon') { Find-PlaylistSyncRbxport } else { Find-PlaylistWizardRbxport }
            }
            $hostExecutable=Assert-RbxportIntegrationPath $hostExecutable
            if(-not(Test-Path -LiteralPath $hostExecutable -PathType Leaf)) { throw 'The selected rbxport executable is missing.' }
        }
        Set-RbxportHostShortcuts -StateDirectory $StateDirectory -ProgramsDirectory $ProgramsDirectory -DesktopDirectory $DesktopDirectory -HostExecutable $hostExecutable -Disable:($registrations.Count -eq 0)
        if($registrations.Count) {
            @{version=2;previousPort=$previous;hostExecutable=$hostExecutable;addons=$registrations} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath ($statePath+'.tmp') -Encoding UTF8
            Move-Item -LiteralPath ($statePath+'.tmp') -Destination $statePath -Force
            foreach($registration in $registrations) { Remove-RbxportAddonShortcuts -Addon $registration.id -ProgramsDirectory $ProgramsDirectory -DesktopDirectory $DesktopDirectory -StartupDirectory $StartupDirectory }
            if(-not $Disable) { Set-RbxportUserPort '43822'; Send-RbxportEnvironmentChanged }
        } else {
            if($saved -and (Get-RbxportUserPort) -eq '43822') { Set-RbxportUserPort $previous; Send-RbxportEnvironmentChanged }
            if(Test-Path -LiteralPath $statePath) { Remove-Item -LiteralPath $statePath }
        }
        # Remove this add-on's old login entry even when it is being disabled.
        Remove-RbxportAddonShortcuts -Addon $addon -ProgramsDirectory $ProgramsDirectory -DesktopDirectory $DesktopDirectory -StartupDirectory $StartupDirectory
    } finally { if($locked) { $mutex.ReleaseMutex() }; $mutex.Dispose() }
}
