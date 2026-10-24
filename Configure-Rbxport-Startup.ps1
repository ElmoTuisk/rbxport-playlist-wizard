param([switch]$Disable, [switch]$NoStart, [switch]$PauseAutomatic)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'scripts\Startup.ps1')
Set-RbxportAddonStartup -Root $PSScriptRoot -Disable:$Disable
if ($Disable) { Write-Output 'Automatic attachment disabled for this add-on. Its running service can be stopped separately.'; return }
if (-not $NoStart) {
    if(Get-Process -Name rbxport -ErrorAction SilentlyContinue) {
        . (Join-Path $PSScriptRoot 'scripts\HostShortcuts.ps1')
        $javascript=Initialize-RbxportJavaScriptLauncher (Join-Path $env:LOCALAPPDATA 'rbxport-addons')
        $arguments=$javascript.arguments
        if($PauseAutomatic) { $arguments+=' --pause-automatic' }
        Start-Process -FilePath $javascript.executable -ArgumentList $arguments -WindowStyle Hidden
    }
}
Write-Output 'The original rbxport shortcuts now start both enabled add-ons. Their services close with rbxport; separate add-on and sign-in shortcuts were removed.'
