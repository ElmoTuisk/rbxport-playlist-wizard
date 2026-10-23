param([string]$Destination = (Join-Path $PSScriptRoot 'playlist-wizard-0.1.2-windows-setup.zip'))
$ErrorActionPreference = 'Stop'
$version = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'package.json') -Raw | ConvertFrom-Json).version
if ($version -ne '0.1.2') { throw 'Update the packager version to match package.json.' }
$include = @('src','public','scripts','test','docs','.github','README.md','AGENTS.md','CONTRIBUTING.md','CHANGELOG.md','LICENSE','LICENSE-AGPL-3.0.txt','THIRD_PARTY.md','package.json','dependencies.json','.gitignore','Start-Playlist-Wizard.ps1','Stop-Playlist-Wizard.ps1','Launch-Playlist-Wizard.cmd','Install-Playlist-Wizard.ps1','Install-Playlist-Wizard.cmd','Package-Addon.ps1','Configure-Rbxport-Startup.ps1')
$paths = $include | ForEach-Object { Join-Path $PSScriptRoot $_ }
foreach ($path in $paths) { if (-not (Test-Path -LiteralPath $path)) { throw "Missing package input: $path" } }
if (Test-Path -LiteralPath $Destination) { throw 'Choose a new destination; the package already exists.' }
$privatePattern = '(?i)(^|[\\/])(\.git|\.local-data|\.tools|\.runtime|\.install-cache|node_modules|test-results)([\\/]|$)|\.sqlite|\.dpapi|launch-url|cookies|installed\.json|service\.pid|\.(mp3|m4a|flac|opus|wav|log|zip|tgz|wasm|cjs|exe|dll)$'
foreach ($path in $paths) {
    $items = if (Test-Path -LiteralPath $path -PathType Container) { Get-ChildItem -LiteralPath $path -Recurse -Force } else { Get-Item -LiteralPath $path -Force }
    foreach ($item in $items) {
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.FullName -match $privatePattern) { throw 'Private data or a linked path was found in the package inputs. Packaging refused.' }
    }
}
Compress-Archive -LiteralPath $paths -DestinationPath $Destination
Write-Output 'Created a source-only Playlist Wizard setup ZIP. Runtime and audio tools are provisioned by the installer.'
