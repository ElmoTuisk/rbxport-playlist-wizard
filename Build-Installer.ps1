param([string]$Destination,[Parameter(Mandatory=$true)][string]$PayloadDirectory)
$ErrorActionPreference='Stop'
& (Join-Path $PSScriptRoot 'scripts\Build-TrustedInstaller.ps1') -Destination $Destination -PayloadDirectory $PayloadDirectory
