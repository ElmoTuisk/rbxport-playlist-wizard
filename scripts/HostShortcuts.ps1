# These helpers are identical in both distributions. No library or pairing data is shared.
function Assert-RbxportIntegrationPath([string]$Path) {
    if (-not [IO.Path]::IsPathRooted($Path) -or $Path.Contains('"')) { throw 'Use an absolute path without quotes.' }
    $full = [IO.Path]::GetFullPath($Path)
    $cursor = $full
    while ($cursor) {
        if ((Test-Path -LiteralPath $cursor) -and ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Linked integration paths are not supported.' }
        $cursor = Split-Path $cursor -Parent
    }
    return $full
}
function Get-RbxportShortcutHash([string]$Path) {
    $stream=[IO.File]::OpenRead($Path); $algorithm=[Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-','') }
    finally { $stream.Dispose(); $algorithm.Dispose() }
}
function Get-RbxportShortcutSignature($Link) {
    return ([ordered]@{target=$Link.TargetPath;arguments=$Link.Arguments;workingDirectory=$Link.WorkingDirectory;windowStyle=$Link.WindowStyle;icon=$Link.IconLocation;description=$Link.Description;hotkey=$Link.Hotkey} | ConvertTo-Json -Compress)
}
function Test-RbxportOwnedShortcut($Entry,$Link) {
    if(-not $Entry) { return $false }
    if((Get-RbxportShortcutHash $Entry.path) -eq $Entry.hash) { return $true }
    # Explorer can refresh link tracking/timestamps without changing its command.
    return ($Entry.signature -and $Entry.signature -ceq (Get-RbxportShortcutSignature $Link))
}
function Initialize-RbxportJavaScriptLauncher([string]$StateDirectory) {
    $null=Assert-RbxportIntegrationPath $StateDirectory
    $root=Split-Path $PSScriptRoot -Parent
    $manifest=Get-Content -LiteralPath (Join-Path $root 'dependencies.json') -Raw | ConvertFrom-Json
    $source=Assert-RbxportIntegrationPath (Join-Path $root '.runtime\node.exe')
    if($manifest.node.url -notmatch '^https://nodejs\.org/dist/' -or $manifest.node.sha256 -notmatch '^[a-f0-9]{64}$' -or -not(Test-Path -LiteralPath $source -PathType Leaf) -or (Get-RbxportShortcutHash $source).ToLowerInvariant() -ne $manifest.node.sha256) { throw 'The private Node.js runtime failed verification. Run setup again before changing shortcuts.' }
    if(-not $script:RbxportVerifiedNodeSignatures) { $script:RbxportVerifiedNodeSignatures=@{} }
    if(-not $script:RbxportVerifiedNodeSignatures.ContainsKey($manifest.node.sha256)) {
        # A caller running PowerShell 7 can leave an incompatible module search path.
        Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
        $signature=Get-AuthenticodeSignature -LiteralPath $source
        if($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch '(?:^|, )O=OpenJS Foundation(?:,|$)') { throw 'The official Node.js publisher signature could not be verified. Windows protection must stay enabled.' }
        $script:RbxportVerifiedNodeSignatures[$manifest.node.sha256]=$true
    }
    $script=Assert-RbxportIntegrationPath (Join-Path $PSScriptRoot 'Start-Rbxport.mjs')
    if(-not(Test-Path -LiteralPath $script -PathType Leaf)) { throw 'The JavaScript launcher is missing. Run setup again.' }
    # Shared, checksum-named runtime survives uninstalling either independent add-on.
    $runtime=Assert-RbxportIntegrationPath (Join-Path $StateDirectory ('runtime\'+$manifest.node.sha256))
    $executable=Join-Path $runtime 'node.exe'
    New-Item -ItemType Directory -Path $StateDirectory -Force | Out-Null
    New-Item -ItemType Directory -Path $runtime -Force | Out-Null
    if(-not(Test-Path -LiteralPath $executable) -or (Get-RbxportShortcutHash $source) -ne (Get-RbxportShortcutHash $executable)) {
        Copy-Item -LiteralPath $source -Destination $executable -Force
    }
    $launcher=Join-Path $StateDirectory 'Start-Rbxport.mjs'
    Copy-Item -LiteralPath $script -Destination $launcher -Force
    return @{executable=$executable;script=$launcher;arguments=('"'+$launcher+'"')}
}
function Set-RbxportHostShortcuts {
    param([string]$StateDirectory,[string]$ProgramsDirectory,[string]$DesktopDirectory,[string]$HostExecutable,[switch]$Disable)
    foreach ($directory in @($StateDirectory,$ProgramsDirectory,$DesktopDirectory)) { $null=Assert-RbxportIntegrationPath $directory }
    $recordPath=Join-Path $StateDirectory 'host-shortcuts.json'
    $legacyPath=Join-Path $StateDirectory 'sync-host-shortcuts.json'
    $saved=if(Test-Path -LiteralPath $recordPath) { Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json } elseif(Test-Path -LiteralPath $legacyPath) { Get-Content -LiteralPath $legacyPath -Raw | ConvertFrom-Json } else { $null }
    $paths=@((Join-Path $ProgramsDirectory 'rbxport.lnk'),(Join-Path $DesktopDirectory 'rbxport.lnk')) | Select-Object -Unique
    $launcher=Join-Path $StateDirectory 'Start-Rbxport.ps1'
    $shell=New-Object -ComObject WScript.Shell
    if($Disable) {
        foreach($entry in $saved.entries) {
            if($entry.path -notin $paths -or -not(Test-Path -LiteralPath $entry.path)) { continue }
            $null=Assert-RbxportIntegrationPath $entry.path
            if(-not(Test-RbxportOwnedShortcut $entry ($shell.CreateShortcut($entry.path)))) { continue }
            if($entry.original) { [IO.File]::WriteAllBytes($entry.path,[Convert]::FromBase64String($entry.original)) }
            else { Remove-Item -LiteralPath $entry.path }
        }
        if(Test-Path -LiteralPath $recordPath) { Remove-Item -LiteralPath $recordPath }
        if(Test-Path -LiteralPath $legacyPath) { Remove-Item -LiteralPath $legacyPath }
        return
    }
    $plans=@()
    foreach($path in $paths) {
        $null=Assert-RbxportIntegrationPath $path
        $old=@($saved.entries | Where-Object path -eq $path) | Select-Object -First 1
        $original=$null
        if(Test-Path -LiteralPath $path) {
            $current=$shell.CreateShortcut($path)
            if(Test-RbxportOwnedShortcut $old $current) { $original=$old.original }
            elseif($old -and $saved.schema -eq 2 -and $current.TargetPath -eq (Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe') -and $current.Arguments -eq ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$launcher+'"') -and $current.WorkingDirectory -eq $StateDirectory -and $current.WindowStyle -eq 7 -and $current.IconLocation -eq ($HostExecutable+',0') -and $current.Description -eq 'Open rbxport with enabled Playlist Sync and Playlist Wizard add-ons' -and -not $current.Hotkey) { $original=$old.original }
            elseif($current.TargetPath -eq $HostExecutable -and -not $current.Arguments) { $original=[Convert]::ToBase64String([IO.File]::ReadAllBytes($path)) }
            else { throw 'A customized rbxport shortcut was left unchanged. Restore its ordinary target before enabling integration.' }
        }
        $plans+=@{path=$path;original=$original}
    }
    New-Item -ItemType Directory -Path $StateDirectory -Force | Out-Null
    $javascript=Initialize-RbxportJavaScriptLauncher $StateDirectory
    foreach($entry in $plans) {
        New-Item -ItemType Directory -Path (Split-Path $entry.path -Parent) -Force | Out-Null
        $temporary=Join-Path (Split-Path $entry.path -Parent) ('rbxport-'+[Guid]::NewGuid().ToString('N')+'.lnk')
        try {
            $link=$shell.CreateShortcut($temporary)
            $link.TargetPath=$javascript.executable
            $link.Arguments=$javascript.arguments; $link.WorkingDirectory=$StateDirectory; $link.WindowStyle=7
            $link.IconLocation=$HostExecutable+',0'; $link.Description='Open rbxport with enabled Playlist Sync and Playlist Wizard add-ons'
            $link.Save(); Move-Item -LiteralPath $temporary -Destination $entry.path -Force
        } finally { if(Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary } }
        $entry.hash=Get-RbxportShortcutHash $entry.path
        $entry.signature=Get-RbxportShortcutSignature ($shell.CreateShortcut($entry.path))
    }
    @{schema=4;entries=$plans} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $recordPath -Encoding UTF8
    if(Test-Path -LiteralPath $legacyPath) { Remove-Item -LiteralPath $legacyPath }
}
function Remove-RbxportAddonShortcuts {
    param([string]$Addon,[string]$ProgramsDirectory,[string]$DesktopDirectory,[string]$StartupDirectory)
    $title=$Addon.Replace('-',' ')
    $paths=@((Join-Path $DesktopDirectory ($title+'.lnk')),(Join-Path $ProgramsDirectory ($title+'\'+$title+'.lnk')),(Join-Path $ProgramsDirectory ($title+'\Stop '+$title+'.lnk')),(Join-Path $StartupDirectory ('rbxport-'+$Addon+'.lnk')))
    $shell=New-Object -ComObject WScript.Shell
    foreach($path in $paths) {
        if(-not(Test-Path -LiteralPath $path)) { continue }
        $null=Assert-RbxportIntegrationPath $path
        $link=$shell.CreateShortcut($path)
        # Only conventional add-on shortcuts; retain customized commands/arguments.
        $pattern='^-NoProfile(?: -WindowStyle Hidden)? -ExecutionPolicy Bypass -File "(?<script>[^"]+\\(?:Start|Stop)-'+[Regex]::Escape($Addon)+'\.ps1)"(?: -Background -NoWindow)?$'
        if($link.TargetPath -ne (Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe') -or $link.Arguments -notmatch $pattern) { continue }
        $script=$Matches.script
        $package=Join-Path (Split-Path $script -Parent) 'package.json'
        $expected='rbxport-'+$Addon.ToLowerInvariant()+'-addon'
        if(-not(Test-Path -LiteralPath $package) -or (Get-Content -LiteralPath $package -Raw | ConvertFrom-Json).name -ne $expected) { continue }
        Remove-Item -LiteralPath $path
    }
}
