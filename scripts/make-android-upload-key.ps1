# Makes the Android upload key for Google Play (0.25.1) - run once, on your own computer, in PowerShell:
#   powershell -ExecutionPolicy Bypass -File scripts\make-android-upload-key.ps1
# It creates %USERPROFILE%\WealthPilot-signing\ with:
#   wealthpilot-upload.jks       the upload key (Google Play only accepts bundles signed with it)
#   KEEP-THIS-SAFE.txt           its password and the values for the four GitHub secrets
# and, if the GitHub CLI (gh) is installed and signed in, offers to save the four secrets in the repository for you.
# Back the folder up somewhere safe (a password manager, or an encrypted USB drive) and never put it in the repository. Losing it is not the
# end of the world - Play Console can reset an upload key - but it takes a few days.
$ErrorActionPreference = 'Stop'
$repo = 'garynth41/wealthpilot'
$dir = Join-Path $env:USERPROFILE 'WealthPilot-signing'
$ks = Join-Path $dir 'wealthpilot-upload.jks'
$alias = 'upload'

$keytool = @(
  $(if ($env:JAVA_HOME) { Join-Path $env:JAVA_HOME 'bin\keytool.exe' }),
  $(if ($env:ProgramFiles) { Join-Path $env:ProgramFiles 'Android\Android Studio\jbr\bin\keytool.exe' }),
  $(if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} 'Android\Android Studio\jbr\bin\keytool.exe' }),
  $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Programs\Android Studio\jbr\bin\keytool.exe' }),
  $(try { (Get-Command keytool -ErrorAction Stop).Source } catch { $null })
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $keytool) {
  Write-Host "keytool was not found. Install Android Studio (it includes Java), or a Java JDK 21, then run this again." -ForegroundColor Yellow
  exit 1
}
if (Test-Path $ks) { Write-Host "An upload key already exists at $ks - not replacing it." -ForegroundColor Yellow; exit 1 }
New-Item -ItemType Directory -Force -Path $dir | Out-Null

# a long random password (letters and digits only, so it pastes cleanly anywhere)
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create(); $bytes = New-Object byte[] 48; $rng.GetBytes($bytes)
$pw = (([Convert]::ToBase64String($bytes)) -replace '[^A-Za-z0-9]', '').Substring(0, 32)

& $keytool -genkeypair -keystore $ks -storetype PKCS12 -alias $alias -keyalg RSA -keysize 4096 -validity 10000 `
  -storepass $pw -keypass $pw -dname "CN=WealthPilot, O=WealthPilot, C=US" | Out-Null
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $ks)) { Write-Host "keytool failed." -ForegroundColor Red; exit 1 }
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($ks))

@"
WealthPilot - Android upload key (made $(Get-Date -Format 'yyyy-MM-dd'))
Keep this file and wealthpilot-upload.jks together and private. Move the password into a password manager, then delete this file.

Keystore file: $ks
Key alias:     $alias
Password:      $pw   (the same for the keystore and the key)

GitHub -> the wealthpilot repository -> Settings -> Secrets and variables -> Actions -> New repository secret:
  ANDROID_UPLOAD_KEYSTORE_BASE64   = the long line below
  ANDROID_UPLOAD_KEYSTORE_PASSWORD = $pw
  ANDROID_UPLOAD_KEY_ALIAS         = $alias
  ANDROID_UPLOAD_KEY_PASSWORD      = $pw

ANDROID_UPLOAD_KEYSTORE_BASE64:
$b64
"@ | Set-Content -Path (Join-Path $dir 'KEEP-THIS-SAFE.txt') -Encoding UTF8
Write-Host "Upload key created in $dir" -ForegroundColor Green

$gh = try { (Get-Command gh -ErrorAction Stop).Source } catch { $null }
if ($gh) {
  # (Windows PowerShell turns a native program's error output into errors when it is redirected, so allow that around this one call)
  $ErrorActionPreference = 'Continue'; & $gh auth status 2>&1 | Out-Null; $signedIn = ($LASTEXITCODE -eq 0); $ErrorActionPreference = 'Stop'
  if ($signedIn -and (Read-Host "Save the four secrets in $repo now with the GitHub CLI? (y/n)") -eq 'y') {
    & $gh secret set ANDROID_UPLOAD_KEYSTORE_BASE64 --repo $repo --body $b64
    & $gh secret set ANDROID_UPLOAD_KEYSTORE_PASSWORD --repo $repo --body $pw
    & $gh secret set ANDROID_UPLOAD_KEY_ALIAS --repo $repo --body $alias
    & $gh secret set ANDROID_UPLOAD_KEY_PASSWORD --repo $repo --body $pw
    Write-Host "Secrets saved." -ForegroundColor Green
    exit 0
  }
}
Write-Host "Add the four secrets by hand - the values are in KEEP-THIS-SAFE.txt (opening the folder)."
Start-Process explorer.exe $dir
