param([string]$Root,[string]$Source,[string]$Fixture)
$ErrorActionPreference='Stop'
$package=Get-Content (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json
$sync=$package.name -eq 'rbxport-playlist-sync-addon'
$id=if($sync){'Playlist-Sync'}else{'Playlist-Wizard'}
. (Join-Path $Root 'scripts\Startup.ps1')
function Get-RbxportUserPort {return $null}
function Set-RbxportUserPort($Value) {throw 'The fixture must not write the environment'}
function Send-RbxportEnvironmentChanged {throw 'The fixture must not notify live apps'}
Set-RbxportAddonStartup -Root $Root -Disable -StateDirectory (Join-Path $Fixture 'Local\rbxport-addons') -ProgramsDirectory (Join-Path $Fixture 'Programs') -DesktopDirectory (Join-Path $Fixture 'Desktop') -StartupDirectory (Join-Path $Fixture 'Startup')
. (Join-Path $Source 'scripts\Installation.ps1')
if($sync){$plan=Get-PlaylistSyncRemovalPlan $Root;Remove-PlaylistSyncProgramFiles $plan}
else{$plan=Get-PlaylistWizardRemovalPlan $Root;Remove-PlaylistWizardProgramFiles $plan}
Write-Output 'JavaScript receipt and shared shortcuts remain compatible with managed removal'
