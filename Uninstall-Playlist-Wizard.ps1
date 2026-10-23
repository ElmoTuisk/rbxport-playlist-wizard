param([switch]$Confirmed, [int]$WaitForProcessId = 0)
$ErrorActionPreference = 'Stop'
try {
    . (Join-Path $PSScriptRoot 'scripts\Installation.ps1')
    . (Join-Path $PSScriptRoot 'scripts\Startup.ps1')
    $plan = Get-PlaylistWizardRemovalPlan $PSScriptRoot
    if (-not $Confirmed) {
        Add-Type -AssemblyName System.Windows.Forms
        $answer = [Windows.Forms.MessageBox]::Show('Uninstall Playlist Wizard? Your music, playlists, saved settings and Playlist Sync will be kept.', 'Playlist Wizard', 'YesNo', 'Question')
        if ($answer -ne 'Yes') { return }
    }
    $pidFile = Join-Path $plan.record.dataDirectory 'service.pid'
    $serviceId = if ($WaitForProcessId) { $WaitForProcessId } elseif (Test-Path -LiteralPath $pidFile) { [int](Get-Content -LiteralPath $pidFile -Raw) } else { 0 }
    if ($serviceId) {
        $service = Get-CimInstance Win32_Process -Filter "ProcessId=$serviceId"
        if ($service) {
            $entry = (Join-Path $PSScriptRoot 'src\server.mjs').Replace('/','\')
            if ($service.Name -ne 'node.exe' -or $service.CommandLine.Replace('/','\').IndexOf(('"' + $entry + '"'),[StringComparison]::OrdinalIgnoreCase) -lt 0) { throw 'The saved process does not belong to this installation. No program files were removed.' }
            if (-not $WaitForProcessId) {
                $launch = (Get-Content -LiteralPath (Join-Path $plan.record.dataDirectory 'launch-url.txt') -Raw).Trim()
                if ($launch -notmatch '^http://127\.0\.0\.1:43823/#[a-f0-9]{64}$') { throw 'Cannot safely connect to this installation.' }
                $headers = @{Authorization=('Bearer ' + $launch.Split('#')[1])}
                $state = Invoke-RestMethod -Uri 'http://127.0.0.1:43823/api/panel' -Headers $headers -TimeoutSec 5
                if ($state.wizard.active) { throw 'Wait for the current Wizard operation to finish or cancel it before uninstalling.' }
                $null = Invoke-RestMethod -Uri 'http://127.0.0.1:43823/api/shutdown' -Method Post -Headers $headers -ContentType 'application/json' -Body '{"ifIdle":true}' -TimeoutSec 5
            }
            for ($attempt=0; $attempt -lt 240; $attempt++) {
                if (-not (Get-Process -Id $serviceId -ErrorAction SilentlyContinue)) { break }
                Start-Sleep -Milliseconds 500
            }
            if (Get-Process -Id $serviceId -ErrorAction SilentlyContinue) { throw 'Playlist Wizard has not finished stopping. No program files were removed.' }
        }
    }
    $startupState = Join-Path $env:LOCALAPPDATA 'rbxport-addons\startup.json'
    if (Test-Path -LiteralPath $startupState) {
        $registered = (Get-Content -LiteralPath $startupState -Raw | ConvertFrom-Json).addons | Where-Object { $_.id -eq 'Playlist-Wizard' -and [IO.Path]::GetFullPath($_.root) -eq $plan.root }
        if ($registered) { Set-RbxportAddonStartup -Root $PSScriptRoot -Disable }
    }
    $shell = New-Object -ComObject WScript.Shell
    foreach ($shortcutPath in $plan.record.shortcuts) {
        if ([IO.Path]::GetExtension($shortcutPath) -ne '.lnk' -or -not (Test-Path -LiteralPath $shortcutPath)) { continue }
        $shortcut = $shell.CreateShortcut($shortcutPath)
        if ($shortcut.WorkingDirectory -eq $plan.root -and $shortcut.Arguments.Contains('"' + $plan.root + '\')) { Remove-Item -LiteralPath $shortcutPath -Force }
    }
    $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\rbxport-playlist-wizard'
    if ((Test-Path -LiteralPath $key) -and (Get-ItemProperty -LiteralPath $key).InstallLocation -eq $plan.root) { Remove-Item -LiteralPath $key }
    Remove-PlaylistWizardProgramFiles $plan
    if (Test-Path -LiteralPath $pidFile) { Remove-Item -LiteralPath $pidFile -Force }
    Add-Type -AssemblyName System.Windows.Forms
    [Windows.Forms.MessageBox]::Show('Playlist Wizard was uninstalled. Your music, playlists and saved settings were kept.', 'Playlist Wizard', 'OK', 'Information') | Out-Null
} catch {
    Add-Type -AssemblyName System.Windows.Forms
    [Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Playlist Wizard uninstall', 'OK', 'Error') | Out-Null
    exit 1
}
