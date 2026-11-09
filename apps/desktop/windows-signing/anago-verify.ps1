<#
.SYNOPSIS
Report the Authenticode signature of Windows artifacts built with the self-signed certificate.

.DESCRIPTION
Prints Get-AuthenticodeSignature status, signer and timestamp for every file, and fails when any
file lacks a valid signature or when a file signed by the bundled certificate lacks a timestamp.
Signature trust requires anago-code-signing.cer in the current user's Trusted Root Certification
Authorities store; the packaging workflow installs it before building.

.PARAMETER Files
Built installers, executables and libraries to report.

.PARAMETER CertificateFile
Public certificate that identifies the self-signed signer; defaults to the certificate beside this script.

.EXAMPLE
./anago-verify.ps1 -Files installer.exe, 'C:\build\app\DeepSeek Harness.exe'
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0, ValueFromRemainingArguments = $true)]
  [string[]]$Files,
  [string]$CertificateFile = (Join-Path $PSScriptRoot 'anago-code-signing.cer')
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $CertificateFile -PathType Leaf)) { throw "The signing certificate was not found: $CertificateFile" }
$certificatePath = (Resolve-Path -LiteralPath $CertificateFile).Path
$expectedThumbprint = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($certificatePath).Thumbprint
$signedByUs = 0
$unverified = @()
foreach ($file in $Files) {
  $path = (Resolve-Path -LiteralPath $file).Path
  $signature = Get-AuthenticodeSignature -LiteralPath $path
  $signer = if ($null -eq $signature.SignerCertificate) { 'none' } else { $signature.SignerCertificate.Subject }
  $timestamp = if ($null -eq $signature.TimeStamperCertificate) { 'missing' } else { $signature.TimeStamperCertificate.NotBefore.ToString('o') }
  Write-Host ($path + [Environment]::NewLine + "  status: $($signature.Status)" + [Environment]::NewLine
    + "  signer: $signer" + [Environment]::NewLine + "  timestamp: $timestamp")
  $ours = $null -ne $signature.SignerCertificate -and $signature.SignerCertificate.Thumbprint -eq $expectedThumbprint
  if ($ours) { $signedByUs++ }
  if ($signature.Status -ne 'Valid' -or ($ours -and $null -eq $signature.TimeStamperCertificate)) {
    $unverified += $path
  }
}
if ($unverified.Count -gt 0) { throw "Missing a valid signature or the self-signed timestamp: $($unverified -join ', ')" }
if ($signedByUs -eq 0) { throw 'No artifact carries the bundled self-signed certificate' }
Write-Host "verified $($Files.Count) artifact(s); $signedByUs signed with the bundled certificate"
