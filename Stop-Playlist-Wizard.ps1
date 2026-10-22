$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'scripts\Desktop.ps1')
$stateDirectory = Get-PlaylistWizardDataDirectory $PSScriptRoot
$pidFile = Join-Path $stateDirectory 'service.pid'
if (Test-Path -LiteralPath $pidFile) {
    $serviceId = [int](Get-Content -LiteralPath $pidFile -Raw)
    $serviceInfo = Get-CimInstance Win32_Process -Filter "ProcessId=$serviceId"
    $expectedEntry = Join-Path $PSScriptRoot 'src\server.mjs'
    if ($serviceInfo -and $serviceInfo.Name -eq 'node.exe' -and $serviceInfo.CommandLine.Contains($expectedEntry)) {
        try {
            $launch = (Get-Content -LiteralPath (Join-Path $stateDirectory 'launch-url.txt') -Raw).Trim()
            if ($launch -match '^http://127\.0\.0\.1:43823/#[a-f0-9]{64}$') {
                $null = Invoke-RestMethod -Uri 'http://127.0.0.1:43823/api/shutdown' -Method Post -Headers @{Authorization=('Bearer ' + $launch.Split('#')[1])} -ContentType 'application/json' -Body '{}' -TimeoutSec 5
                for ($attempt = 0; $attempt -lt 15; $attempt++) { if (-not (Get-Process -Id $serviceId -ErrorAction SilentlyContinue)) { break }; Start-Sleep -Milliseconds 200 }
            }
        } catch { }
        if (Get-Process -Id $serviceId -ErrorAction SilentlyContinue) { Stop-Process -Id $serviceId }
    }
    Remove-Item -LiteralPath $pidFile
}
Write-Output 'Playlist Wizard stopped for this session. The next original rbxport shortcut launch starts enabled add-ons again. Configure-Rbxport-Startup.ps1 -Disable removes only Wizard integration.'
