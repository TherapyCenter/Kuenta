# Kuenta – build the Windows installer
#
#   powershell -ExecutionPolicy Bypass -File installer\windows\build.ps1
#
# Result: build\Kuenta-Setup-<version>.exe
# Requires Inno Setup 6 (https://jrsoftware.org/isdl.php). Node.js is downloaded automatically
# (checksum verified against nodejs.org) and packed into the installer, so nothing else
# needs to be installed on the target computer.
param(
  [string]$NodeVersion = '24.21.0',
  [string]$Iscc = '',
  [switch]$NurStage   # only prepare build\stage, without calling Inno Setup
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$root  = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$build = Join-Path $root 'build'
$stage = Join-Path $build 'stage'
$cache = Join-Path $build 'cache'
$pkg = Get-Content (Join-Path $root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$version = $pkg.version
Write-Host "Kuenta $version  (Node.js $NodeVersion)"

# --- fetch and verify Node.js ---
New-Item -ItemType Directory -Force $cache | Out-Null
$nodeName = "node-v$NodeVersion-win-x64"
$zip = Join-Path $cache "$nodeName.zip"
$base = "https://nodejs.org/dist/v$NodeVersion"
if (-not (Test-Path $zip)) {
  Write-Host "Downloading $nodeName.zip ..."
  Invoke-WebRequest "$base/$nodeName.zip" -OutFile $zip -UseBasicParsing
}
$sums = (Invoke-WebRequest "$base/SHASUMS256.txt" -UseBasicParsing).Content
$line = ($sums -split "`n") | Where-Object { $_ -match "\s$nodeName\.zip$" }
if (-not $line) { throw "No checksum found for $nodeName.zip." }
$expected = ($line -split '\s+')[0].ToLower()
$actual = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
if ($expected -ne $actual) { Remove-Item $zip; throw "Checksum of $nodeName.zip does not match – download deleted, please run again." }
Write-Host "Node.js checksum ok."

# --- assemble the files ---
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force $stage | Out-Null
foreach ($d in 'server', 'public', 'docs') { Copy-Item -Recurse (Join-Path $root $d) (Join-Path $stage $d) }
# SMS relay for the computer with the USB modem (started separately there)
Copy-Item -Recurse (Join-Path (Join-Path $root 'installer') 'sms-relais') (Join-Path $stage 'sms-relais')
foreach ($f in 'package.json', 'README.md', 'README.de.md', 'INSTALL.md', 'INSTALL.de.md', 'LICENSE', 'PRO.md', 'PRO.de.md', 'Kuenta starten.bat', 'Kuenta im Netzwerk starten.bat') {
  $p = Join-Path $root $f
  if (Test-Path $p) { Copy-Item $p $stage }
}
$tmp = Join-Path $cache 'node-extract'
if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
Expand-Archive $zip -DestinationPath $tmp
$nodeDir = Join-Path $stage 'node'
New-Item -ItemType Directory -Force $nodeDir | Out-Null
Copy-Item (Join-Path $tmp "$nodeName\node.exe") $nodeDir
Copy-Item (Join-Path $tmp "$nodeName\LICENSE") (Join-Path $nodeDir 'LICENSE.txt')
Remove-Item -Recurse -Force $tmp
Write-Host "Files ready in $stage"
if ($NurStage) { return }

# --- Inno Setup ---
if (-not $Iscc) {
  $cands = @(
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "$env:ProgramFiles\Inno Setup 6\ISCC.exe",
    "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
  )
  $Iscc = $cands | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $Iscc) { $c = Get-Command iscc -ErrorAction SilentlyContinue; if ($c) { $Iscc = $c.Source } }
}
if (-not $Iscc) { throw 'Inno Setup 6 (ISCC.exe) not found. Please install it: https://jrsoftware.org/isdl.php  (or pass -Iscc <path>)' }
& $Iscc "/DAppVersion=$version" "/DStageDir=$stage" "/DOutDir=$build" (Join-Path $PSScriptRoot 'kuenta.iss')
if ($LASTEXITCODE -ne 0) { throw "Inno Setup reports an error ($LASTEXITCODE)." }
Write-Host "`nDone: $build\Kuenta-Setup-$version.exe"
