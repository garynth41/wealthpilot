#Requires -Version 5.1
<#
.SYNOPSIS
  First-time setup of PocketLedger on Windows: extract → install → test (npm run check) → production build → start dev server.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File setup.ps1 -Zip "C:\Users\garyn\OneDrive\Claude_Apps\PocketLedger\pocketledger-v0.1.1.zip"

.PARAMETER Zip
  Path to the project zip. Default: the newest pocketledger-v*.zip in the folder this script is in, then in
  %USERPROFILE%\OneDrive\Claude_Apps\PocketLedger, then in Downloads.
.PARAMETER Dest
  Where the project goes. Default: %USERPROFILE%\CascadeProjects\pocketledger. Keep this OUTSIDE OneDrive —
  node_modules has tens of thousands of files and OneDrive sync fights with npm install.
.PARAMETER SkipCheck   Skip `npm run check` (typecheck + unit tests + build + Playwright smoke).
.PARAMETER NoDev       Don't start the dev server / open the browser at the end.
#>
param(
  [string]$Zip,
  [string]$Dest = (Join-Path $env:USERPROFILE 'CascadeProjects\pocketledger'),
  [switch]$SkipCheck,
  [switch]$NoDev
)
$ErrorActionPreference = 'Stop'
function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "   OK  $m" -ForegroundColor Green }
function Warn($m) { Write-Host "   !!  $m" -ForegroundColor Yellow }
function Fail($m) { Write-Host "`nFAILED: $m" -ForegroundColor Red; exit 1 }
function Run($exe, [string[]]$args) {
  Write-Host "   > $exe $($args -join ' ')" -ForegroundColor DarkGray
  & $exe @args
  if ($LASTEXITCODE -ne 0) { Fail "$exe $($args -join ' ') exited with code $LASTEXITCODE" }
}

# ---------- 1. prerequisites ----------
Step 'Checking prerequisites'
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Fail 'Node.js is not installed. Install the LTS from https://nodejs.org (20 or newer), reopen PowerShell, run again.' }
$nodeVer = (& node -v).TrimStart('v'); $major = [int]($nodeVer.Split('.')[0])
if ($major -lt 20) { Fail "Node $nodeVer is too old — the app needs 20 or newer." }
Ok "Node $nodeVer"
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue; if (-not $npm) { Fail 'npm.cmd not found on PATH.' }
Ok "npm $(& npm.cmd -v)"
$git = Get-Command git -ErrorAction SilentlyContinue
if ($git) { Ok "git $((& git --version) -replace 'git version ','')" } else { Warn 'git not found — needed later for GitHub Pages deploy (https://git-scm.com).' }
if (Get-Command gh -ErrorAction SilentlyContinue) { Ok 'GitHub CLI (gh) present' } else { Warn 'GitHub CLI (gh) not found — optional; makes creating the repo for deploy easier (winget install GitHub.cli).' }
if ($Dest -match 'OneDrive') { Warn "Destination is inside OneDrive ($Dest). npm install will be slow and sync may corrupt node_modules. Consider -Dest outside OneDrive." }

# ---------- 2. locate the zip ----------
Step 'Locating the project zip'
if (-not $Zip) {
  $candidates = @($PSScriptRoot, (Join-Path $env:USERPROFILE 'OneDrive\Claude_Apps\PocketLedger'), (Join-Path $env:USERPROFILE 'Downloads')) |
    Where-Object { $_ -and (Test-Path $_) } |
    ForEach-Object { Get-ChildItem -Path $_ -Filter 'pocketledger-v*.zip' -ErrorAction SilentlyContinue } |
    Sort-Object LastWriteTime -Descending
  if (-not $candidates) { Fail 'No pocketledger-v*.zip found. Pass -Zip "<path>".' }
  $Zip = $candidates[0].FullName
}
if (-not (Test-Path $Zip)) { Fail "Zip not found: $Zip" }
Ok $Zip

# ---------- 3. extract ----------
Step "Extracting to $Dest"
$tmp = Join-Path $env:TEMP ("pocketledger-extract-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
Expand-Archive -Path $Zip -DestinationPath $tmp -Force
# the zip may contain the project at its root or inside a single top-level folder
$src = $tmp
if (-not (Test-Path (Join-Path $src 'package.json'))) {
  $inner = Get-ChildItem -Path $tmp -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'package.json') } | Select-Object -First 1
  if (-not $inner) { Fail 'package.json not found in the zip.' }
  $src = $inner.FullName
}
$keepEnv = $null
if (Test-Path $Dest) {
  if (Test-Path (Join-Path $Dest '.env')) { $keepEnv = Get-Content (Join-Path $Dest '.env') -Raw }
  $bak = "$Dest.bak-" + (Get-Date -Format 'yyyyMMdd-HHmm')
  Warn "Destination exists — moving the old copy to $bak"
  Move-Item -Path $Dest -Destination $bak
}
New-Item -ItemType Directory -Path (Split-Path $Dest -Parent) -Force | Out-Null
Move-Item -Path $src -Destination $Dest
Remove-Item -Path $tmp -Recurse -Force -ErrorAction SilentlyContinue
Ok 'Extracted'

# ---------- 4. .env ----------
Step 'Environment file'
Set-Location $Dest
if ($keepEnv) { Set-Content -Path .env -Value $keepEnv -NoNewline; Ok 'Kept your existing .env' }
elseif (-not (Test-Path .env)) { Copy-Item .env.example .env; Ok '.env created from .env.example (points at the pocketledger Supabase project)' }
else { Ok '.env already present' }

# ---------- 5. install ----------
Step 'Installing packages (npm install)'
Run 'npm.cmd' @('install', '--no-audit', '--no-fund')
Ok 'Packages installed'

Step 'Installing the Playwright browser for the smoke tests'
& npx.cmd playwright install chromium
if ($LASTEXITCODE -ne 0) {
  $fallback = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
                "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe", "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($fallback) { $env:PW_CHROMIUM = $fallback; Warn "Playwright download failed — using $fallback for the smoke tests instead" }
  else { Warn 'Playwright download failed and no Chrome/Edge found; the e2e step of npm run check will fail.' }
} else { Ok 'Chromium ready' }

# ---------- 6. testing: typecheck + unit tests + production build + smoke ----------
if ($SkipCheck) { Step 'Skipping npm run check (-SkipCheck)'; Run 'npm.cmd' @('run', 'build') }
else {
  Step 'Running the full check: typecheck → 32 unit tests → production build → Playwright smoke (desktop + phone)'
  Run 'npm.cmd' @('run', 'check')
  Ok 'All checks passed'
}

# ---------- 7. production build summary ----------
Step 'Production build'
if (Test-Path (Join-Path $Dest 'dist\index.html')) {
  $size = [math]::Round(((Get-ChildItem dist -Recurse -File | Measure-Object Length -Sum).Sum / 1MB), 2)
  Ok "dist\ is ready ($size MB) - this is what 'npm run deploy' publishes to GitHub Pages"
} else { Warn 'dist\index.html not found — the build did not complete.' }
if (Test-Path .git) { Ok 'Git repository present (commit history preserved from the zip)' } elseif ($git) { & git init -q; & git add -A; & git -c user.name=setup -c user.email=setup@local commit -q -m 'PocketLedger initial import'; Ok 'Initialised a git repository' }

# ---------- 8. start the dev server ----------
if (-not $NoDev) {
  Step 'Starting the dev server (new window) and opening the app'
  Start-Process powershell -ArgumentList '-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', "Set-Location '$Dest'; `$host.UI.RawUI.WindowTitle = 'PocketLedger dev server — close this window to stop'; npm.cmd run dev"
  $up = $false
  foreach ($i in 1..40) {
    Start-Sleep -Milliseconds 500
    try { $null = Invoke-WebRequest -Uri 'http://localhost:5173/' -UseBasicParsing -TimeoutSec 2; $up = $true; break } catch {}
  }
  if ($up) { Start-Process 'http://localhost:5173/'; Ok 'App is running at http://localhost:5173 (dev server window stays open)' }
  else { Warn 'The dev server has not answered yet — check the dev-server window, then open http://localhost:5173 yourself.' }
}

Write-Host @"

=====================================================================
 PocketLedger is set up at: $Dest
   dev server:   npm run dev      -> http://localhost:5173
   full check:   npm run check    (typecheck, tests, build, smoke)
   production:   npm run build    -> dist\   |   npm run deploy -> GitHub Pages

 Next, in the browser:
   1. "Open the offline demo"  - try everything with sample data
   2. "Create an account"       - garynthomas@gmail.com + password, click the
                                  confirmation email, then Sign in
   3. Name your household        - "Create household"
=====================================================================
"@ -ForegroundColor White
