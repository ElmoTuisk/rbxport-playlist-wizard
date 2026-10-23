param([string]$NodePath, [string]$RbxportPath, [Alias('NoBrowser')][switch]$NoWindow, [switch]$Detached, [switch]$Background, [switch]$PauseAutomatic, [switch]$HostOnly)
$ErrorActionPreference = 'Stop'
trap {
    if (-not $NoWindow -and -not $Background) {
        Add-Type -AssemblyName System.Windows.Forms
        [Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Playlist Wizard', 'OK', 'Error') | Out-Null
    } else { Write-Error $_ -ErrorAction Continue }
    exit 1
}
$addonRoot = $PSScriptRoot
. (Join-Path $addonRoot 'scripts\Desktop.ps1')
$RbxportPath = Find-PlaylistWizardRbxport $RbxportPath
$hostProcess = Get-PlaylistWizardHostProcess $RbxportPath
if ($Background -and -not $hostProcess) { Write-Output 'rbxport is closed. Playlist Wizard will start with its rbxport shortcut.'; return }
$stateDirectory = Get-PlaylistWizardDataDirectory $addonRoot
New-Item -ItemType Directory -Force -Path $stateDirectory | Out-Null
if (-not $NodePath) {
    $privateNode = Join-Path $addonRoot '.runtime\node.exe'
    $NodePath = if (Test-Path -LiteralPath $privateNode) { $privateNode } else { 'node' }
}
$nodeVersion = & $NodePath --version
if ($LASTEXITCODE -ne 0 -or [int]($nodeVersion.TrimStart('v').Split('.')[0]) -lt 24) { throw 'Run Install-Playlist-Wizard.cmd to set up the private runtime.' }
if (-not $Background) {
if ($Detached -and -not $NoWindow) { $browserPath = Find-PlaylistWizardBrowser }
$automationReady = $false
try { $null = Invoke-RestMethod -Uri 'http://127.0.0.1:43822/json/version' -TimeoutSec 2; $automationReady = $true } catch { }
if (-not $automationReady) {
    if (Get-Process -Name rbxport -ErrorAction SilentlyContinue) { throw 'Close rbxport normally, then open Playlist Wizard again. The add-on will start rbxport with its local connection enabled.' }
    $oldPort = $env:RBXPORT_DEVTOOLS_PORT
    try { $env:RBXPORT_DEVTOOLS_PORT = '43822'; $null = Start-Process -FilePath $RbxportPath -WindowStyle Hidden -PassThru }
    finally { if ($null -eq $oldPort) { Remove-Item Env:RBXPORT_DEVTOOLS_PORT -ErrorAction SilentlyContinue } else { $env:RBXPORT_DEVTOOLS_PORT = $oldPort } }
}
}
for ($attempt=0; $attempt -lt 40 -and -not $hostProcess; $attempt++) {
    $hostProcess = Get-PlaylistWizardHostProcess $RbxportPath
    if (-not $hostProcess) { Start-Sleep -Milliseconds 250 }
}
if (-not $hostProcess) { throw 'The compatible rbxport process did not start. Playlist Wizard has not been left running.' }
$serviceReady = $false
try { $null = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:43823/' -TimeoutSec 2; $serviceReady = $true } catch { }
$launchFile = Join-Path $stateDirectory 'launch-url.txt'
if ($serviceReady -and -not (Test-Path -LiteralPath $launchFile)) { throw 'A different Playlist Wizard installation is running. Stop it before opening this installation.' }
if ($serviceReady) {
    $savedLaunch=(Get-Content -LiteralPath $launchFile -Raw).Trim()
    if($savedLaunch -notmatch '^http://127\.0\.0\.1:43823/#([a-f0-9]{64})$') { throw 'Invalid local launch URL' }
    $session=Invoke-RestMethod -Uri 'http://127.0.0.1:43823/api/panel' -Headers @{Authorization=('Bearer '+$Matches[1])} -TimeoutSec 5
    if($session.hostPid -and $session.hostPid -ne $hostProcess.Id) {
        # A quick close/reopen can overlap the previous session's graceful shutdown.
        for($attempt=0;$attempt -lt 40 -and (Test-PlaylistWizardServiceListening);$attempt++) { Start-Sleep -Milliseconds 250 }
        if(Test-PlaylistWizardServiceListening) { throw 'The previous rbxport session is still finishing. Wait a moment and open rbxport again.' }
        $serviceReady=$false
    }
}
if (-not $serviceReady) {
    $entry = Join-Path $addonRoot 'src\server.mjs'
    $processArgs = @(('"' + $entry + '"'), '--data-dir', ('"' + $stateDirectory + '"'), '--host-pid', [string]$hostProcess.Id)
    if ($PauseAutomatic) { $processArgs += '--pause-automatic' }
    $service = Start-Process -FilePath $NodePath -ArgumentList $processArgs -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $stateDirectory 'service.log') -RedirectStandardError (Join-Path $stateDirectory 'service-error.log')
    Set-Content -LiteralPath (Join-Path $stateDirectory 'service.pid') -Value $service.Id
}
$serviceReady = $false
for ($attempt = 0; $attempt -lt 60; $attempt++) {
    try { $null = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:43823/' -TimeoutSec 1; if (Test-Path -LiteralPath $launchFile) { $serviceReady = $true; break } } catch { }
    Start-Sleep -Milliseconds 250
}
if (-not $serviceReady) { throw "The service did not start. See $stateDirectory\service-error.log" }
$launchUrl = (Get-Content -LiteralPath $launchFile -Raw).Trim()
$hostConnection = Connect-PlaylistWizardHost $launchUrl
if ($Background) { Write-Output 'Playlist Wizard is attached to this rbxport session and will close with it.'; return }
$windowArguments = Get-PlaylistWizardWindowArguments $launchUrl (Join-Path $stateDirectory 'window-profile')
if (-not $NoWindow -and -not $HostOnly) {
    if ($Detached) { Start-Process -FilePath $browserPath -ArgumentList $windowArguments }
    else {
        $pairingCode = $launchUrl.Split('#')[1]
        $opened = $false
        for ($attempt = 0; $attempt -lt 15; $attempt++) {
            try {
                $null = Invoke-RestMethod -Uri 'http://127.0.0.1:43823/api/ui/open' -Method Post -Headers @{Authorization = "Bearer $pairingCode"} -ContentType 'application/json' -Body '{}' -TimeoutSec 10
                $opened = $true
                break
            } catch { Start-Sleep -Milliseconds 500 }
        }
        if (-not $opened) { throw 'Could not attach Playlist Wizard to rbxport. Close rbxport normally and open the Playlist Wizard shortcut again.' }
    }
}
if ($hostConnection.libraryReady -eq $false) {
    Write-Warning ('Playlist Wizard is visible, but syncing is paused. ' + $hostConnection.connectionError)
} else {
    Write-Output 'Playlist Wizard is running. Open it under Tag List on the left in rbxport, or click the symbol beside a linked playlist.'
}
