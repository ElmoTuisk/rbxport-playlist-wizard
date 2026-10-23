param([switch]$PauseAutomatic, [switch]$NoWindow)
$ErrorActionPreference = 'Stop'
# Installed in the shared registration directory, independent of either add-on.
$mutex = New-Object Threading.Mutex($false, 'Local\rbxport-addons-launch')
$locked = $false
try {
    $locked = $mutex.WaitOne(90000)
    if (-not $locked) { throw 'Another rbxport launch is still finishing.' }
    $state = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'startup.json') -Raw | ConvertFrom-Json
    $executable = $state.hostExecutable
    if (-not $executable -or -not [IO.Path]::IsPathRooted($executable) -or -not (Test-Path -LiteralPath $executable -PathType Leaf)) { throw 'The registered rbxport installation is missing. Run Configure-Rbxport-Startup.ps1 again.' }
    $hosts = @(Get-Process -Name rbxport -ErrorAction SilentlyContinue)
    $selected = @($hosts | Where-Object { $_.Path -and [IO.Path]::GetFullPath($_.Path) -eq [IO.Path]::GetFullPath($executable) })
    if ($hosts.Count -ne $selected.Count -or $selected.Count -gt 1) { throw 'Close the other rbxport copy before opening the integrated shortcut.' }
    if (-not $selected.Count) {
        $previousPort = $env:RBXPORT_DEVTOOLS_PORT
        try { $env:RBXPORT_DEVTOOLS_PORT = '43822'; $null = Start-Process -FilePath $executable -PassThru }
        finally { if ($null -eq $previousPort) { Remove-Item Env:RBXPORT_DEVTOOLS_PORT -ErrorAction SilentlyContinue } else { $env:RBXPORT_DEVTOOLS_PORT = $previousPort } }
    }
    for ($attempt=0; $attempt -lt 40; $attempt++) {
        $selected=@(Get-Process -Name rbxport -ErrorAction SilentlyContinue | Where-Object { $_.Path -and [IO.Path]::GetFullPath($_.Path) -eq [IO.Path]::GetFullPath($executable) })
        if($selected.Count -eq 1) { break }
        Start-Sleep -Milliseconds 250
    }
    if($selected.Count -ne 1) { throw 'The selected rbxport process did not start.' }
    $failures = @()
    foreach ($registration in @($state.addons | Sort-Object id)) {
        $expectedName = switch ($registration.id) { 'Playlist-Sync' { 'rbxport-playlist-sync-addon' }; 'Playlist-Wizard' { 'rbxport-playlist-wizard-addon' }; default { $null } }
        try {
            if (-not $expectedName) { throw 'Unknown add-on registration' }
            $root = [IO.Path]::GetFullPath($registration.root)
            if ($root.Contains('"')) { throw 'Invalid add-on path' }
            if ((Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).name -ne $expectedName) { throw 'The registered add-on is missing or changed' }
            $launcher = Join-Path $root ('Start-' + $registration.id + '.ps1')
            if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) { throw 'The registered launcher is missing' }
            $arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $launcher + '" -Background -NoWindow -RbxportPath "' + $executable + '"'
            if ($PauseAutomatic) { $arguments += ' -PauseAutomatic' }
            # Start-Process -Wait follows descendants, including the persistent Node service.
            # Wait only for the short launcher itself so the companion can start next.
            $start=New-Object Diagnostics.ProcessStartInfo
            $start.FileName=Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
            $start.Arguments=$arguments; $start.WorkingDirectory=$root
            $start.UseShellExecute=$false; $start.CreateNoWindow=$true
            $start.RedirectStandardError=$true
            $child=New-Object Diagnostics.Process
            $child.StartInfo=$start
            try {
                if(-not $child.Start()) { throw 'Windows could not start the add-on launcher' }
                $errors=$child.StandardError.ReadToEndAsync()
                if(-not $child.WaitForExit(90000)) { throw 'The add-on launcher timed out; see its private service log' }
                if($child.ExitCode -ne 0) {
                    $detail=if($errors.Wait(1000)) { $errors.Result } else { 'No error details returned' }
                    throw ('The add-on could not start: '+$detail)
                }
            } finally { $child.Dispose() }
        } catch { $failures += $registration.id + ': ' + $_.Exception.Message }
    }
    if ($failures.Count) { throw ($failures -join "`n") }
} catch {
    if ($NoWindow) { Write-Error $_ -ErrorAction Continue }
    else { Add-Type -AssemblyName System.Windows.Forms; [Windows.Forms.MessageBox]::Show($_.Exception.Message, 'rbxport add-ons', 'OK', 'Error') | Out-Null }
    exit 1
} finally { if ($locked) { $mutex.ReleaseMutex() }; $mutex.Dispose() }
