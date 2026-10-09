#Requires -Version 5.1
<#
.SYNOPSIS
  Authenticode-sign Windows release artifacts (exe/msi/dll/cab) before archiving.

.DESCRIPTION
  Intended for GitHub Actions when repository secrets are configured.
  CI should gate invocation with: if secrets.WINDOWS_CODE_SIGNING_CERT != ''

  Local / dry-run: omit secrets and use -SkipIfNoSecrets (default) to exit 0.
  Intentional signing test: -RequireSecrets fails with a clear message if env is incomplete.

  Alternative: Azure Trusted Signing when AZURE_TRUSTED_SIGNING_ACCOUNT_NAME is set
  (see docs/ops/windows-service-and-signing.md Phase C).
#>
param(
  [Parameter(Mandatory = $true)]
  [string] $PackageDir,

  [string] $TimestampUrl = $(if ($env:WINDOWS_TIMESTAMP_URL) { $env:WINDOWS_TIMESTAMP_URL } else { "http://timestamp.digicert.com" }),

  [switch] $RequireSecrets,

  [switch] $SkipIfNoSecrets = $true
)

$ErrorActionPreference = "Stop"

function Write-Info([string] $Message) {
  Write-Host "[sign-windows] $Message"
}

function Fail([string] $Message) {
  Write-Error "[sign-windows] $Message"
  exit 1
}

if (-not (Test-Path -LiteralPath $PackageDir)) {
  Fail "PackageDir does not exist: $PackageDir"
}

$useAzure = [bool]$env:AZURE_TRUSTED_SIGNING_ACCOUNT_NAME
$usePfx = [bool]$env:WINDOWS_CODE_SIGNING_CERT

if (-not $useAzure -and -not $usePfx) {
  $msg = @(
    "No signing credentials found."
    "Set WINDOWS_CODE_SIGNING_CERT (+ WINDOWS_CODE_SIGNING_CERT_PASSWORD) for PFX signing,"
    "or configure Azure Trusted Signing env vars (see Phase C runbook)."
  ) -join " "
  if ($RequireSecrets) {
    Fail $msg
  }
  if ($SkipIfNoSecrets) {
    Write-Info "SKIP: $msg"
    exit 0
  }
  Fail $msg
}

$extensions = @(".exe", ".msi", ".dll", ".cab", ".sys")
$files = Get-ChildItem -LiteralPath $PackageDir -Recurse -File |
  Where-Object { $extensions -contains $_.Extension.ToLowerInvariant() }

if ($files.Count -eq 0) {
  Write-Info "No Authenticode-eligible binaries under $PackageDir (expected until a signed launcher/installer is added). Nothing to sign."
  exit 0
}

Write-Info "Found $($files.Count) file(s) to sign."

if ($useAzure) {
  $requiredAzure = @(
    "AZURE_TRUSTED_SIGNING_ACCOUNT_NAME",
    "AZURE_TRUSTED_SIGNING_CERT_PROFILE_NAME",
    "AZURE_CLIENT_ID",
    "AZURE_TENANT_ID"
  )
  foreach ($name in $requiredAzure) {
    $val = [Environment]::GetEnvironmentVariable($name)
    if ([string]::IsNullOrWhiteSpace($val)) {
      Fail "Azure Trusted Signing: missing env $name"
    }
  }
  if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
    Fail "Azure CLI (az) is required for Trusted Signing but was not found on PATH."
  }
  Write-Info "Using Azure Trusted Signing profile $($env:AZURE_TRUSTED_SIGNING_CERT_PROFILE_NAME)."
  foreach ($file in $files) {
    $target = $file.FullName
    Write-Info "Signing (Azure): $target"
    az trusted-signing sign `
      --account-name $env:AZURE_TRUSTED_SIGNING_ACCOUNT_NAME `
      --certificate-profile $env:AZURE_TRUSTED_SIGNING_CERT_PROFILE_NAME `
      --files $target | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Fail "Azure Trusted Signing failed for $target (exit $LASTEXITCODE)"
    }
  }
  Write-Info "Azure signing complete."
  exit 0
}

if (-not $env:WINDOWS_CODE_SIGNING_CERT_PASSWORD) {
  Fail "WINDOWS_CODE_SIGNING_CERT_PASSWORD is required when WINDOWS_CODE_SIGNING_CERT is set."
}

$pfxPath = Join-Path $env:TEMP "remote-agent-codesign.pfx"
try {
  [IO.File]::WriteAllBytes($pfxPath, [Convert]::FromBase64String($env:WINDOWS_CODE_SIGNING_CERT))
} catch {
  Fail "WINDOWS_CODE_SIGNING_CERT is not valid base64: $($_.Exception.Message)"
}

$signtool = $env:SIGNTOOL_PATH
if (-not $signtool) {
  $sdkSign = "${env:ProgramFiles(x86)}\Windows Kits\10\bin\10.0.22621.0\x64\signtool.exe"
  if (Test-Path -LiteralPath $sdkSign) {
    $signtool = $sdkSign
  } else {
    $signtool = "signtool.exe"
  }
}

if (-not (Get-Command $signtool -ErrorAction SilentlyContinue)) {
  Fail "signtool not found (set SIGNTOOL_PATH or install Windows SDK). Tried: $signtool"
}

try {
  foreach ($file in $files) {
    $target = $file.FullName
    Write-Info "Signing (PFX): $target"
    & $signtool sign /f $pfxPath /p $env:WINDOWS_CODE_SIGNING_CERT_PASSWORD /fd SHA256 /tr $TimestampUrl /td SHA256 $target
    if ($LASTEXITCODE -ne 0) {
      Fail "signtool failed for $target (exit $LASTEXITCODE)"
    }
  }
  Write-Info "PFX signing complete."
} finally {
  if (Test-Path -LiteralPath $pfxPath) { Remove-Item -LiteralPath $pfxPath -Force -ErrorAction SilentlyContinue }
}
