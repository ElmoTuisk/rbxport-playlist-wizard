param([string]$NodePath)
$ErrorActionPreference='Stop'
$repo=Split-Path $PSScriptRoot -Parent
$fixture=Join-Path ([IO.Path]::GetTempPath()) ('playlist-wizard-setup-test-'+[Guid]::NewGuid().ToString('N'))
try {
    New-Item -ItemType Directory -Path $fixture | Out-Null
    $compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
    $output=Join-Path $fixture 'fixture.exe'
    & $compiler /nologo /target:exe /main:SetupHarness ('/out:'+$output) /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll (Join-Path $repo 'installer\Setup.cs') (Join-Path $PSScriptRoot 'setup-harness.cs')
    if($LASTEXITCODE -ne 0) { throw 'Fixture compilation failed' }
    & $output check $fixture $NodePath
    if($LASTEXITCODE -ne 0) { throw 'Installer fixture failed' }
} finally {
    $full=[IO.Path]::GetFullPath($fixture)
    $temp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')+'\'
    if(-not $full.StartsWith($temp,[StringComparison]::OrdinalIgnoreCase) -or (Split-Path $full -Leaf) -notmatch '^playlist-wizard-setup-test-[a-f0-9]{32}$') { throw 'Unsafe fixture cleanup' }
    if(Test-Path -LiteralPath $full) { Remove-Item -LiteralPath $full -Recurse -Force }
}
