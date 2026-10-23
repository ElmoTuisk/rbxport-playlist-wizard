param([switch]$PauseAutomatic, [switch]$NoWindow)
$ErrorActionPreference = 'Stop'
# Installed in the shared registration directory, independent of either add-on.
$mutex = New-Object Threading.Mutex($false, 'Local\rbxport-addons-launch')
$locked = $false
$children = @()
try {
    try { $locked = $mutex.WaitOne(5000) } catch [Threading.AbandonedMutexException] { $locked=$true }
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
    $hostId=$selected[0].Id
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
            # Dispatch both independent launchers before waiting for their readiness.
            $start=New-Object Diagnostics.ProcessStartInfo
            $start.FileName=Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
            $start.Arguments=$arguments; $start.WorkingDirectory=$root
            $start.UseShellExecute=$false; $start.CreateNoWindow=$true
            $start.RedirectStandardError=$true
            $child=New-Object Diagnostics.Process
            $child.StartInfo=$start
            if(-not $child.Start()) { $child.Dispose();throw 'Windows could not start the add-on launcher' }
            $children+=@{id=$registration.id;process=$child;errors=$child.StandardError.ReadToEndAsync();started=[DateTime]::UtcNow;finished=$false}
        } catch { $failures += $registration.id + ': ' + $_.Exception.Message }
    }
    while(@($children | Where-Object {-not $_.finished}).Count) {
        $alive=@(Get-Process -Name rbxport -ErrorAction SilentlyContinue | Where-Object {$_.Id -eq $hostId -and $_.Path -and [IO.Path]::GetFullPath($_.Path) -eq [IO.Path]::GetFullPath($executable)})
        if(-not $alive.Count) { throw [OperationCanceledException]::new('rbxport closed during startup') }
        foreach($entry in @($children | Where-Object {-not $_.finished})) {
            if($entry.process.WaitForExit(100)) {
                $entry.finished=$true
                if($entry.process.ExitCode -ne 0) {
                    $detail=if($entry.errors.Wait(1000)) { $entry.errors.Result } else { 'No error details returned' }
                    $failures+=$entry.id+': '+$detail
                }
            } elseif(([DateTime]::UtcNow-$entry.started).TotalSeconds -gt 45) {
                $entry.process.Kill();$entry.finished=$true
                $failures+=$entry.id+': Startup timed out; see its private service log'
            }
        }
    }
    if ($failures.Count) { throw ($failures -join "`n") }
} catch [OperationCanceledException] {
    exit 3
} catch {
    if ($NoWindow) { Write-Error $_ -ErrorAction Continue }
    else { Add-Type -AssemblyName System.Windows.Forms; [Windows.Forms.MessageBox]::Show($_.Exception.Message, 'rbxport add-ons', 'OK', 'Error') | Out-Null }
    exit 1
} finally {
    foreach($entry in $children) {
        try { if(-not $entry.process.HasExited) { $entry.process.Kill() } } catch { }
        $entry.process.Dispose()
    }
    if ($locked) { $mutex.ReleaseMutex() }; $mutex.Dispose()
}
