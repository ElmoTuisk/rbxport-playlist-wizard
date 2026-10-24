// Fixed Windows API operations. Request data travels over stdin, never as code.
import { spawn as windowsSpawn } from 'node:child_process';
import { join as windowsJoin } from 'node:path';

const windowsScript = String.raw`
$ErrorActionPreference='Stop'
$q=[Console]::In.ReadToEnd() | ConvertFrom-Json
if($q.slug -notin @('rbxport-playlist-sync','rbxport-playlist-wizard')){throw 'Unknown product'}
$ws=New-Object -ComObject WScript.Shell
function Links($paths){
 @($paths | ForEach-Object {
  $path=[string]$_
  if(Test-Path -LiteralPath $path -PathType Leaf){
   $l=$ws.CreateShortcut($path)
   @{path=$path;exists=$true;bytes=[Convert]::ToBase64String([IO.File]::ReadAllBytes($path));properties=[ordered]@{target=$l.TargetPath;arguments=$l.Arguments;workingDirectory=$l.WorkingDirectory;windowStyle=$l.WindowStyle;icon=$l.IconLocation;description=$l.Description;hotkey=$l.Hotkey}}
  }else{@{path=$path;exists=$false}}
 })
}
$key='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\'+$q.slug
switch($q.action){
 'inventory' {
  if($q.fixture){
   $result=@{local=(Join-Path $q.fixture 'Local');desktop=(Join-Path $q.fixture 'Desktop');programs=(Join-Path $q.fixture 'Programs');startup=(Join-Path $q.fixture 'Startup');processes=@();userPort=$null;registeredRoot=$null;hostCandidates=@((Join-Path $q.fixture 'rbxport.exe'));registry=$null}
  }else{
   $registry=Get-ItemProperty -LiteralPath $key -ErrorAction SilentlyContinue
   $values=$null;if($registry){$values=@{};foreach($p in $registry.PSObject.Properties){if($p.Name -notlike 'PS*'){$values[$p.Name]=$p.Value}}}
   $candidates=@((Join-Path $env:ProgramFiles 'rbxport\rbxport.exe'),(Join-Path $env:LOCALAPPDATA 'Programs\rbxport\rbxport.exe'),(Join-Path $env:LOCALAPPDATA 'rbxport\rbxport.exe'))
   foreach($base in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall')){
    foreach($entry in @(Get-ChildItem -LiteralPath $base -ErrorAction SilentlyContinue)){
     $v=Get-ItemProperty -LiteralPath $entry.PSPath -ErrorAction SilentlyContinue
     if($v.DisplayName -eq 'rbxport' -and $v.InstallLocation){$candidates+=Join-Path $v.InstallLocation.Trim('"') 'rbxport.exe'}
    }
   }
   if(Get-Command Get-AppxPackage -ErrorAction SilentlyContinue){
    foreach($p in @(Get-AppxPackage -Name 'TRIODE.rbxport' -ErrorAction SilentlyContinue | Where-Object {$_.PackageFamilyName -eq 'TRIODE.rbxport_0bxvsfj6epqjp' -and [Version]$_.Version -ge [Version]'1.9.0'})){$candidates+=Join-Path $p.InstallLocation 'rbxport.exe'}
   }
   $processes=@(Get-CimInstance Win32_Process -Filter "Name='rbxport.exe' OR Name='node.exe'" | ForEach-Object {@{pid=$_.ProcessId;name=$_.Name;path=$_.ExecutablePath;command=$_.CommandLine}})
   $result=@{local=$env:LOCALAPPDATA;desktop=[Environment]::GetFolderPath('Desktop');programs=[Environment]::GetFolderPath('Programs');startup=[Environment]::GetFolderPath('Startup');processes=$processes;userPort=[Environment]::GetEnvironmentVariable('RBXPORT_DEVTOOLS_PORT','User');registeredRoot=$registry.InstallLocation;hostCandidates=@($candidates | Where-Object {Test-Path -LiteralPath $_ -PathType Leaf} | Select-Object -Unique);registry=$values}
  }
 }
 'signature' {
  Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
  $s=Get-AuthenticodeSignature -LiteralPath $q.path
  $result=@{valid=($s.Status -eq 'Valid' -and $s.SignerCertificate.Subject -match '(?:^|, )O=OpenJS Foundation(?:,|$)')}
 }
 'links' {$result=Links $q.paths}
 'write-links' {
  foreach($e in $q.entries){
   $actual=$null
   if(Test-Path -LiteralPath $e.path -PathType Leaf){$stream=[IO.File]::OpenRead($e.path);$sha=[Security.Cryptography.SHA256]::Create();try{$actual=[BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','').ToLowerInvariant()}finally{$stream.Dispose();$sha.Dispose()}}
   if($actual -ne $e.expectedHash){throw 'Shortcut changed during setup'}
   $temp=Join-Path (Split-Path $e.path -Parent) ('rbxport-'+[Guid]::NewGuid().ToString('N')+'.lnk')
   try{
    $l=$ws.CreateShortcut($temp);$l.TargetPath=$e.properties.target;$l.Arguments=$e.properties.arguments;$l.WorkingDirectory=$e.properties.workingDirectory;$l.WindowStyle=$e.properties.windowStyle;$l.IconLocation=$e.properties.icon;$l.Description=$e.properties.description;$l.Hotkey=$e.properties.hotkey;$l.Save()
    Move-Item -LiteralPath $temp -Destination $e.path -Force
   }finally{if(Test-Path -LiteralPath $temp){Remove-Item -LiteralPath $temp}}
  }
  $result=Links @($q.entries | ForEach-Object path)
 }
 'ffmpeg' {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip=[IO.Compression.ZipFile]::OpenRead($q.archive)
  try{foreach($name in @('ffmpeg.exe','ffprobe.exe')){
   $entries=@($zip.Entries | Where-Object {$_.FullName -match ('/bin/'+[Regex]::Escape($name)+'$')})
   if($entries.Count -ne 1 -or $entries[0].Length -gt 256MB){throw 'Unexpected FFmpeg archive'}
   [IO.Compression.ZipFileExtensions]::ExtractToFile($entries[0],(Join-Path $q.directory $name),$false)
  }}finally{$zip.Dispose()}
  $result=@{extracted=$true}
 }
 'registry' {
  if($q.fixture){$file=Join-Path $q.fixture ($q.slug+'-registry.json');$q.values | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $file -Encoding UTF8}
  elseif($null -eq $q.values){if(Test-Path -LiteralPath $key){Remove-Item -LiteralPath $key}}
  else{
   New-Item -Path $key -Force | Out-Null
   foreach($p in $q.values.PSObject.Properties){$type=if($p.Name -in @('NoModify','NoRepair')){'DWord'}else{'String'};New-ItemProperty -LiteralPath $key -Name $p.Name -Value $p.Value -PropertyType $type -Force | Out-Null}
  }
  $result=@{written=$true}
 }
 default {throw 'Unknown Windows operation'}
}
ConvertTo-Json -InputObject $result -Depth 8 -Compress
`;

export function createWindowsOps({ fixtureRoot } = {}) {
  async function call(slug, action, data = {}) {
    const executable = windowsJoin(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const child = windowsSpawn(executable, ['-NoProfile', '-NonInteractive', '-Command', windowsScript], { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', size = 0;
    const timeout = setTimeout(() => child.kill(), 30000);
    try {
      return await new Promise((resolve, reject) => {
        child.stdout.on('data', chunk => { size += chunk.length; if (size > 4 * 1024 * 1024) child.kill(); else output += chunk; });
        child.stderr.resume(); // Raw Windows diagnostics can contain private paths; never publish them.
        child.once('error', () => reject(Error('Windows setup services could not start.')));
        child.once('close', code => {
          if (code !== 0) return reject(Error(`Windows setup operation failed (${action}). Windows protection was not changed.`));
          try { resolve(JSON.parse(output.trim())); } catch { reject(Error('Windows setup returned an invalid response.')); }
        });
        child.stdin.on('error', () => {});
        child.stdin.end(JSON.stringify({ ...data, slug, action, ...(fixtureRoot ? { fixture: fixtureRoot } : {}) }));
      });
    } finally { clearTimeout(timeout); }
  }
  return { call };
}
