<#
.SYNOPSIS
Sign Windows files with the Anago Harness self-signed code-signing certificate.

.DESCRIPTION
Signs one or more files with the Windows SDK signtool and an RFC 3161 timestamp. The PFX comes from
ANAGO_WINDOWS_PFX_FILE, or from ANAGO_WINDOWS_PFX_BASE64 decoded into a temporary file that is removed
afterwards; its password comes from ANAGO_PFX_PASSWORD and is never printed. Every file must sign under
the bundled certificate and carry a timestamp, or the script fails. Chain trust is not required, because
the self-signed root is only added to the stores of the people who install the published certificate.

.PARAMETER Files
Executables or libraries to sign.

.PARAMETER TimeStampServer
RFC 3161 timestamp server.

.PARAMETER SignTool
signtool.exe to use. The newest Windows SDK signtool is selected when this is omitted.

.EXAMPLE
$env:ANAGO_WINDOWS_PFX_BASE64 = Get-Content -Raw signing.pfx.b64
$env:ANAGO_PFX_PASSWORD = 'secret'
./anago-sign.ps1 -Files 'C:\build\DeepSeek Harness.exe'
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0, ValueFromRemainingArguments = $true)]
  [string[]]$Files,
  [string]$TimeStampServer = 'http://timestamp.digicert.com',
  [string]$SignTool
)

$ErrorActionPreference = 'Stop'

function Resolve-SignToolPath {
  param([string]$Requested)
  if ($Requested) {
    if (Test-Path -LiteralPath $Requested -PathType Leaf) { return (Resolve-Path -LiteralPath $Requested).Path }
    throw "SignTool was not found: $Requested"
  }
  $onPath = Get-Command signtool.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -ne $onPath) { return $onPath.Source }
  foreach ($root in @(${env:ProgramFiles(x86)}, $env:ProgramFiles)) {
    if ([string]::IsNullOrEmpty($root)) { continue }
    $bin = Join-Path $root 'Windows Kits\10\bin'
    if (-not (Test-Path -LiteralPath $bin -PathType Container)) { continue }
    $found = Get-ChildItem -LiteralPath $bin -Directory |
      Sort-Object -Property Name -Descending |
      ForEach-Object { Join-Path $_.FullName 'x64\signtool.exe' } |
      Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
      Select-Object -First 1
    if ($null -ne $found) { return $found }
  }
  throw 'signtool.exe was not found; install the Windows SDK or set ANAGO_SIGNTOOL'
}

$signToolPath = if ($env:ANAGO_SIGNTOOL) { $env:ANAGO_SIGNTOOL } else { $SignTool }
$signToolPath = Resolve-SignToolPath -Requested $signToolPath

$password = $env:ANAGO_PFX_PASSWORD
if ([string]::IsNullOrEmpty($password)) { throw 'ANAGO_PFX_PASSWORD must contain the self-signed PFX password' }

$temporaryPfx = $null
$pfx = $env:ANAGO_WINDOWS_PFX_FILE
if ([string]::IsNullOrEmpty($pfx)) {
  $encoded = $env:ANAGO_WINDOWS_PFX_BASE64
  if ([string]::IsNullOrEmpty($encoded)) { throw 'Set ANAGO_WINDOWS_PFX_FILE or ANAGO_WINDOWS_PFX_BASE64 to the signing PFX' }
  $temporaryPfx = Join-Path ([IO.Path]::GetTempPath()) ('anago-signing-' + [guid]::NewGuid().ToString('N') + '.pfx')
  [IO.File]::WriteAllBytes($temporaryPfx, [Convert]::FromBase64String($encoded))
  $pfx = $temporaryPfx
}
if (-not (Test-Path -LiteralPath $pfx -PathType Leaf)) { throw "PFX was not found: $pfx" }

# The self-signed chain is trusted by the people who install the public certificate, never by the build host,
# so signing verifies that the signature names this certificate and carries a timestamp rather than chain trust.
$certificateFile = Join-Path $PSScriptRoot 'anago-code-signing.cer'
if (-not (Test-Path -LiteralPath $certificateFile -PathType Leaf)) { throw "The signing certificate was not found: $certificateFile" }
$expectedThumbprint = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new(
  (Resolve-Path -LiteralPath $certificateFile).Path).Thumbprint

# The call operator passes each value as one argument, so paths and the password need no shell quoting.
try {
  foreach ($file in $Files) {
    $path = (Resolve-Path -LiteralPath $file).Path
    & $signToolPath sign /f $pfx /p $password /fd sha256 /td sha256 /tr $TimeStampServer $path
    if ($LASTEXITCODE -ne 0) { throw "signtool sign exited with $LASTEXITCODE for $path" }
    $signature = Get-AuthenticodeSignature -LiteralPath $path
    if ($null -eq $signature.SignerCertificate) { throw "signature is missing: $path" }
    if ($signature.SignerCertificate.Thumbprint -ne $expectedThumbprint) { throw "signed by another certificate ($($signature.SignerCertificate.Subject)): $path" }
    if ($null -eq $signature.TimeStamperCertificate) { throw "signature has no RFC 3161 timestamp: $path" }
    Write-Host "signed $path (publisher $($signature.SignerCertificate.Subject), timestamp $($signature.TimeStamperCertificate.NotBefore.ToString('o')))"
  }
}
finally {
  if ($null -ne $temporaryPfx) { Remove-Item -LiteralPath $temporaryPfx -Force -ErrorAction SilentlyContinue }
}
