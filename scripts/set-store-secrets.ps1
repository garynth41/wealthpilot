# Saves the App Store Connect and Google Play keys as GitHub secrets for the release workflow (0.25.1). Run on your own computer, in
# PowerShell, after downloading the keys (docs/STORE_LAUNCH.md, steps A9 and B4). Needs the GitHub CLI (https://cli.github.com), signed in
# with `gh auth login`. Each part is optional - give only what you have:
#   powershell -ExecutionPolicy Bypass -File scripts\set-store-secrets.ps1 `
#     -P8 "$env:USERPROFILE\Downloads\AuthKey_ABC123XYZ9.p8" -KeyId ABC123XYZ9 -IssuerId 69a6de7e-...-... -TeamId A1B2C3D4E5 `
#     -PlayJson "$env:USERPROFILE\Downloads\wealthpilot-play-....json"
# The key files themselves stay where they are; keep them somewhere safe and never put them in the repository.
param([string]$P8, [string]$KeyId, [string]$IssuerId, [string]$TeamId, [string]$PlayJson, [string]$Repo = 'garynth41/wealthpilot')
$ErrorActionPreference = 'Stop'
$gh = try { (Get-Command gh -ErrorAction Stop).Source } catch { $null }
if (-not $gh) { Write-Host "The GitHub CLI (gh) is not installed: get it from https://cli.github.com, run 'gh auth login', then run this again." -ForegroundColor Yellow; exit 1 }
$ErrorActionPreference = 'Continue'; & $gh auth status 2>&1 | Out-Null; $signedIn = ($LASTEXITCODE -eq 0); $ErrorActionPreference = 'Stop'   # see make-android-upload-key.ps1
if (-not $signedIn) { Write-Host "Run 'gh auth login' first." -ForegroundColor Yellow; exit 1 }
$done = @()
# values go to gh on standard input: Windows PowerShell mangles quotes inside command-line arguments (the Play key is JSON)
function Set-Secret([string]$name, [string]$value) { if (-not $value) { throw "$name is empty" }; $value | & $gh secret set $name --repo $Repo; if ($LASTEXITCODE -ne 0) { throw "could not save $name" }; $script:done += $name }

if ($P8 -or $KeyId -or $IssuerId -or $TeamId) {
  if (-not ($P8 -and $KeyId -and $IssuerId -and $TeamId)) { Write-Host "For iOS give all four: -P8, -KeyId, -IssuerId and -TeamId." -ForegroundColor Yellow; exit 1 }
  if (-not (Test-Path $P8)) { Write-Host "Not found: $P8" -ForegroundColor Yellow; exit 1 }
  if ((Get-Content $P8 -Raw) -notmatch 'BEGIN PRIVATE KEY') { Write-Host "$P8 does not look like an App Store Connect key (.p8)." -ForegroundColor Yellow; exit 1 }
  if ($TeamId -notmatch '^[A-Z0-9]{10}$') { Write-Host "The Team ID is 10 letters and digits (Apple Developer -> Membership details)." -ForegroundColor Yellow; exit 1 }
  Set-Secret 'ASC_KEY_P8_BASE64' ([Convert]::ToBase64String([IO.File]::ReadAllBytes((Resolve-Path $P8).Path)))
  Set-Secret 'ASC_KEY_ID' $KeyId.Trim()
  Set-Secret 'ASC_ISSUER_ID' $IssuerId.Trim()
  Set-Secret 'APPLE_TEAM_ID' $TeamId.Trim()
}
if ($PlayJson) {
  if (-not (Test-Path $PlayJson)) { Write-Host "Not found: $PlayJson" -ForegroundColor Yellow; exit 1 }
  $raw = Get-Content $PlayJson -Raw
  try { $j = $raw | ConvertFrom-Json } catch { Write-Host "$PlayJson is not JSON." -ForegroundColor Yellow; exit 1 }
  if (-not $j.client_email -or -not $j.private_key) { Write-Host "$PlayJson is not a Google service account key (no client_email / private_key)." -ForegroundColor Yellow; exit 1 }
  Set-Secret 'PLAY_SERVICE_ACCOUNT_JSON' $raw
}
if ($done.Count) { Write-Host ("Saved in {0}: {1}" -f $Repo, ($done -join ', ')) -ForegroundColor Green } else { Write-Host "Nothing to do - see the examples at the top of this script." }
