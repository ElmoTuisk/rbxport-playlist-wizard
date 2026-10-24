$ErrorActionPreference='Stop'
$repo=Split-Path $PSScriptRoot -Parent
. (Join-Path $repo 'scripts\ReleaseTrust.ps1')
function Assert-Trust($Value,$Message) { if(-not $Value) { throw $Message } }
$fixture=Join-Path ([IO.Path]::GetTempPath()) ('rbxport-trust-'+[Guid]::NewGuid().ToString('N'))
try {
    New-Item -ItemType Directory -Path (Join-Path $fixture 'scripts'),(Join-Path $fixture 'release') -Force | Out-Null
    @{schema=1;status='pending';publisherSubjects=@()} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $fixture 'release-signing.json')
    Set-Content -LiteralPath (Join-Path $fixture 'scripts\fixture.ps1') '# fixture'
    @{name='rbxport-playlist-sync-addon'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $fixture 'package.json')
    foreach($path in @('Start-Playlist-Sync.ps1','Stop-Playlist-Sync.ps1','Uninstall-Playlist-Sync.ps1','Configure-Rbxport-Startup.ps1','scripts\Desktop.ps1','scripts\HostShortcuts.ps1','scripts\Installation.ps1','scripts\ReleaseTrust.ps1','scripts\Start-Rbxport.ps1','scripts\Startup.ps1')) { Set-Content -LiteralPath (Join-Path $fixture $path) '# fixture' }
    Set-Content -LiteralPath (Join-Path $fixture 'scripts\Start-Rbxport.mjs') '// synthetic JavaScript; never executed'
    $rejected=$false;try { Assert-RbxportReleaseTrust $fixture -RequireLauncher } catch { $rejected=$_.Exception.Message -match 'pending' }
    Assert-Trust $rejected 'Pending publisher policy must refuse integration'
    @{schema=1;status='approved';publisherSubjects=@('CN=Fixture Publisher')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $fixture 'release-signing.json')
    $script:status='NotSigned';$script:subject='CN=Fixture Publisher';$script:timestamp=$true;$script:verified=@()
    # Signature results are mocked, never a certificate or a Windows trust-store change.
    function Get-AuthenticodeSignature {
        param($LiteralPath)
        $script:verified+=Split-Path $LiteralPath -Leaf
        return @{Status=$script:status;SignerCertificate=@{Subject=$script:subject};TimeStamperCertificate=$(if($script:timestamp){@{Subject='Fixture Timestamp'}}else{$null})}
    }
    foreach($invalid in @('NotSigned','HashMismatch','NotTrusted','UnknownError')) {
        $script:status=$invalid;$rejected=$false;try { Assert-RbxportReleaseTrust $fixture -RequireLauncher } catch { $rejected=$true }
        Assert-Trust $rejected ('Must reject '+$invalid)
    }
    $script:status='Valid';$script:subject='CN=Other Publisher'
    $rejected=$false;try { Assert-RbxportReleaseTrust $fixture -RequireLauncher } catch { $rejected=$true }
    Assert-Trust $rejected 'A different trusted publisher must be refused'
    $script:subject='CN=Fixture Publisher';$script:timestamp=$false
    $rejected=$false;try { Assert-RbxportReleaseTrust $fixture -RequireLauncher } catch { $rejected=$true }
    Assert-Trust $rejected 'A missing timestamp must be refused'
    $script:timestamp=$true;$script:verified=@()
    Assert-RbxportReleaseTrust $fixture -RequireLauncher
    Assert-Trust ('fixture.ps1' -in $script:verified -and 'Start-Playlist-Sync.ps1' -in $script:verified) 'Validate setup scripts while the JavaScript launcher is included in the signed payload'
    $script:verified=@()
    Set-Content -LiteralPath (Join-Path $fixture 'Install-Legacy.ps1') '# legacy fixture'
    Assert-RbxportReleaseTrust $fixture -RequireLauncher -Installed
    Assert-Trust ('Install-Legacy.ps1' -notin $script:verified -and 'Start-Playlist-Sync.ps1' -in $script:verified -and 'Startup.ps1' -in $script:verified) 'Retained legacy setup files must not block validation of the fixed runtime chain'
    Remove-Item -LiteralPath (Join-Path $fixture 'Stop-Playlist-Sync.ps1')
    $rejected=$false;try { Assert-RbxportReleaseTrust $fixture -RequireLauncher -Installed } catch { $rejected=$true }
    Assert-Trust $rejected 'Every runtime entry is required'
    Set-Content -LiteralPath (Join-Path $fixture 'Stop-Playlist-Sync.ps1') '# fixture'
    Remove-Item -LiteralPath (Join-Path $fixture 'scripts\Start-Rbxport.mjs')
    $rejected=$false;try { Assert-RbxportReleaseTrust $fixture -RequireLauncher } catch { $rejected=$true }
    Assert-Trust $rejected 'A missing JavaScript launcher must fail payload validation'
    Write-Output 'Release trust checks passed'
} finally {
    $full=[IO.Path]::GetFullPath($fixture)
    $temp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')+'\'
    if(-not $full.StartsWith($temp,[StringComparison]::OrdinalIgnoreCase) -or (Split-Path $full -Leaf) -notmatch '^rbxport-trust-[a-f0-9]{32}$') { throw 'Unsafe fixture cleanup' }
    Remove-Item -LiteralPath $full -Recurse -Force
}
