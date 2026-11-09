<#
.SYNOPSIS
Report the Authenticode signature of Windows artifacts built with the self-signed certificate.

.DESCRIPTION
Prints status, signer and RFC 3161 genTime for every file. A Valid signature is accepted
regardless of signer, because a packaged tree includes upstream binaries signed by their own
publisher; it does not need a timestamp token. UnknownError passes only when the signer thumbprint
matches the pinned certificate and the RFC 3161 timestamp token verifies. UnknownError is the
status an untrusted self-signed root produces on a build host that has not installed the
certificate. Every other status is a failure and is named.
The token check reads the unsigned attribute 1.3.6.1.4.1.311.3.3.1 and that token's genTime. It
does not use TimeStamperCertificate or that certificate's NotBefore. Chain trust is not required.

.PARAMETER Files
Built installers, executables and libraries to report.

.PARAMETER CertificateFile
Public certificate that identifies the self-signed signer; defaults to the certificate beside this script.

.PARAMETER Json
Write one JSON report per file and do not enforce the pinned identity. Packaging uses this so an
unsigned file can be distinguished from a rejected signature.

.EXAMPLE
./anago-verify.ps1 -Files installer.exe, 'C:\build\app\DeepSeek Harness.exe'
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0, ValueFromRemainingArguments = $true)]
  [string[]]$Files,
  [string]$CertificateFile = (Join-Path $PSScriptRoot 'anago-code-signing.cer'),
  [switch]$Json
)

$ErrorActionPreference = 'Stop'
# PowerShell 7's PSModulePath makes Windows PowerShell 5.1 fail to autoload Security. Stay on this interpreter's modules.
# A caller may already have disabled autoload; restore it only after the path is narrowed, then disable it again.
$env:PSModulePath = Join-Path $PSHOME 'Modules'
$PSModuleAutoloadingPreference = 'All'
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try { [Console]::OutputEncoding = $OutputEncoding }
catch {
  # windowsHide starts this process with no console; SetConsoleOutputCP throws IOException. $OutputEncoding still covers redirected output.
}

function Import-AnagoInterpreterModule {
  param([Parameter(Mandatory = $true)][string]$Name, [Parameter(Mandatory = $true)][string]$Stopped)
  $manifest = Join-Path $PSHOME "Modules\$Name\$Name.psd1"
  if (-not [System.IO.File]::Exists($manifest)) { throw "$Name was not found at $manifest. $Stopped" }
  try { $null = Import-Module -LiteralPath $manifest -ErrorAction Stop }
  catch { throw "$Name could not be loaded from $manifest. $Stopped $($_.Exception.Message)" }
}

function Import-AnagoAuthenticodeModules {
  param([Parameter(Mandatory = $true)][string]$Stopped)
  Import-AnagoInterpreterModule -Name 'Microsoft.PowerShell.Security' -Stopped $Stopped
  Import-AnagoInterpreterModule -Name 'Microsoft.PowerShell.Utility' -Stopped $Stopped
  Import-AnagoInterpreterModule -Name 'Microsoft.PowerShell.Management' -Stopped $Stopped
  $loaded = Get-Command Get-AuthenticodeSignature -ErrorAction SilentlyContinue
  $modulePath = if ($null -eq $loaded -or $null -eq $loaded.Module) { '' } else { [string]$loaded.Module.Path }
  if ($null -eq $loaded -or [string]::IsNullOrEmpty($modulePath) -or -not $modulePath.StartsWith($PSHOME, [StringComparison]::OrdinalIgnoreCase)) {
    $shown = if ($null -eq $loaded) { 'missing' } elseif ([string]::IsNullOrEmpty($modulePath)) { $loaded.Source } else { $modulePath }
    throw "Get-AuthenticodeSignature is not loaded from $PSHOME (loaded from $shown). $Stopped"
  }
}

function Read-DerLength {
  param([byte[]]$Bytes, [int]$Offset)
  if ($Offset -ge $Bytes.Length) { throw 'DER length is truncated' }
  $first = [int]$Bytes[$Offset]
  if ($first -lt 0x80) { return @{ Length = $first; Next = $Offset + 1 } }
  $count = $first -band 0x7F
  if ($count -eq 0 -or $count -gt 4) { throw 'DER length is indefinite or oversized' }
  if (($Offset + 1 + $count) -gt $Bytes.Length) { throw 'DER length is truncated' }
  $length = [int64]0
  for ($i = 0; $i -lt $count; $i++) { $length = ($length -shl 8) -bor [int]$Bytes[$Offset + 1 + $i] }
  return @{ Length = [int]$length; Next = $Offset + 1 + $count }
}

function Read-DerElement {
  param([byte[]]$Bytes, [int]$Offset)
  if ($Offset -lt 0 -or $Offset -ge $Bytes.Length) { throw 'DER value is truncated' }
  $tag = [int]$Bytes[$Offset]
  $length = Read-DerLength -Bytes $Bytes -Offset ($Offset + 1)
  $end = $length.Next + $length.Length
  if ($end -gt $Bytes.Length) { throw 'DER value is truncated' }
  $content = New-Object byte[] $length.Length
  if ($length.Length -gt 0) { [System.Buffer]::BlockCopy($Bytes, $length.Next, $content, 0, $length.Length) }
  return @{ Tag = $tag; Content = $content; Next = $end }
}

function Get-DerChildren {
  param([byte[]]$Content)
  $items = New-Object System.Collections.Generic.List[object]
  $offset = 0
  while ($offset -lt $Content.Length) {
    $item = Read-DerElement -Bytes $Content -Offset $offset
    [void]$items.Add($item)
    $offset = $item.Next
  }
  return ,$items.ToArray()
}

function Trim-DerSequence {
  param([byte[]]$Bytes, [string]$Path)
  if ($null -eq $Bytes -or $Bytes.Length -lt 2 -or $Bytes[0] -ne 0x30) { throw "signature is not PKCS#7: $Path" }
  $element = Read-DerElement -Bytes $Bytes -Offset 0
  if ($element.Next -eq $Bytes.Length) {
    Write-Output $Bytes -NoEnumerate
    return
  }
  $trimmed = New-Object byte[] $element.Next
  [System.Buffer]::BlockCopy($Bytes, 0, $trimmed, 0, $element.Next)
  Write-Output $trimmed -NoEnumerate
}

function Convert-DerOid {
  param([byte[]]$Content)
  if ($null -eq $Content -or $Content.Length -eq 0) { throw 'OID is empty' }
  $first = [int]$Content[0]
  $parts = New-Object System.Collections.Generic.List[string]
  [void]$parts.Add([string][math]::Floor($first / 40))
  [void]$parts.Add([string]($first % 40))
  $value = [int64]0
  $pending = $false
  for ($i = 1; $i -lt $Content.Length; $i++) {
    $byte = [int]$Content[$i]
    $value = ($value -shl 7) -bor ($byte -band 0x7F)
    $pending = $true
    if (($byte -band 0x80) -eq 0) {
      [void]$parts.Add([string]$value)
      $value = 0
      $pending = $false
    }
  }
  if ($pending) { throw 'OID is truncated' }
  return ($parts -join '.')
}

function Convert-GeneralizedTime {
  param([string]$Value)
  if ($Value -notmatch '^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\.(\d{1,9}))?Z$') {
    throw 'genTime is not a UTC GeneralizedTime'
  }
  $year = [int]$Matches[1]
  $month = [int]$Matches[2]
  $day = [int]$Matches[3]
  $hour = [int]$Matches[4]
  $minute = [int]$Matches[5]
  $second = [int]$Matches[6]
  $null = [datetime]::new($year, $month, $day, $hour, $minute, $second, [DateTimeKind]::Utc)
  $fraction = if ($Matches[7]) { ".$($Matches[7])" } else { '' }
  return '{0:D4}-{1:D2}-{2:D2}T{3:D2}:{4:D2}:{5:D2}{6}Z' -f $year, $month, $day, $hour, $minute, $second, $fraction
}

function Get-PeCertificateBytes {
  param([string]$Path)
  $bytes = [System.IO.File]::ReadAllBytes($Path)
  if ($bytes.Length -lt 64 -or $bytes[0] -ne 0x4D -or $bytes[1] -ne 0x5A) { throw "signature table is missing: $Path" }
  $lfanew = [BitConverter]::ToInt32($bytes, 0x3C)
  if ($lfanew -lt 0 -or ($lfanew + 24) -gt $bytes.Length) { throw "signature table is missing: $Path" }
  if ($bytes[$lfanew] -ne 0x50 -or $bytes[$lfanew + 1] -ne 0x45 -or $bytes[$lfanew + 2] -ne 0 -or $bytes[$lfanew + 3] -ne 0) {
    throw "signature table is missing: $Path"
  }
  $optional = $lfanew + 24
  $magic = [BitConverter]::ToUInt16($bytes, $optional)
  $numberOffset = if ($magic -eq 0x10B) { 92 } elseif ($magic -eq 0x20B) { 108 } else { throw "signature table is missing: $Path" }
  if (($optional + $numberOffset + 8) -gt $bytes.Length) { throw "signature table is missing: $Path" }
  $numberOfRva = [BitConverter]::ToUInt32($bytes, $optional + $numberOffset)
  if ($numberOfRva -lt 5) { throw "signature table is missing: $Path" }
  $directory = $optional + $numberOffset + 4 + 32
  if (($directory + 8) -gt $bytes.Length) { throw "signature table is missing: $Path" }
  $certOffset = [BitConverter]::ToInt32($bytes, $directory)
  $certSize = [BitConverter]::ToInt32($bytes, $directory + 4)
  if ($certOffset -le 0 -or $certSize -lt 8 -or ($certOffset + $certSize) -gt $bytes.Length) { throw "signature table is missing: $Path" }
  $dwLength = [BitConverter]::ToInt32($bytes, $certOffset)
  $certType = [BitConverter]::ToUInt16($bytes, $certOffset + 6)
  if ($certType -ne 2 -or $dwLength -lt 8 -or ($certOffset + $dwLength) -gt $bytes.Length) { throw "signature is not PKCS#7: $Path" }
  $pkcs7 = New-Object byte[] ($dwLength - 8)
  [System.Buffer]::BlockCopy($bytes, $certOffset + 8, $pkcs7, 0, $pkcs7.Length)
  Write-Output (Trim-DerSequence -Bytes $pkcs7 -Path $Path) -NoEnumerate
}

function Get-AuthenticodeEncryptedDigest {
  param([byte[]]$Bytes, [string]$Path)
  $contentInfo = Read-DerElement -Bytes $Bytes -Offset 0
  if ($contentInfo.Tag -ne 0x30) { throw "signature is not PKCS#7: $Path" }
  $outer = Get-DerChildren -Content $contentInfo.Content
  if ($outer.Count -lt 2 -or $outer[1].Tag -ne 0xA0) { throw "signature is not PKCS#7: $Path" }
  $signed = Read-DerElement -Bytes $outer[1].Content -Offset 0
  if ($signed.Tag -ne 0x30) { throw "signature is not PKCS#7: $Path" }
  $signerSet = $null
  foreach ($field in (Get-DerChildren -Content $signed.Content)) {
    if ($field.Tag -eq 0x31) { $signerSet = $field }
  }
  if ($null -eq $signerSet) { throw "signature has no signer: $Path" }
  $signer = Read-DerElement -Bytes $signerSet.Content -Offset 0
  if ($signer.Tag -ne 0x30) { throw "signature has no signer: $Path" }
  $parts = Get-DerChildren -Content $signer.Content
  if ($parts.Count -lt 5 -or $parts[2].Tag -ne 0x30) { throw "signature has no signer: $Path" }
  $index = 3
  if ($parts[$index].Tag -eq 0xA0) { $index++ }
  if (($index + 1) -ge $parts.Count -or $parts[$index].Tag -ne 0x30 -or $parts[$index + 1].Tag -ne 0x04) {
    throw "signature has no signer: $Path"
  }
  Write-Output $parts[$index + 1].Content -NoEnumerate
}

function Test-SameBytes {
  param([byte[]]$Left, [byte[]]$Right)
  if ($null -eq $Left -or $null -eq $Right -or $Left.Length -ne $Right.Length) { return $false }
  $diff = 0
  for ($i = 0; $i -lt $Left.Length; $i++) { $diff = $diff -bor ([int]$Left[$i] -bxor [int]$Right[$i]) }
  return $diff -eq 0
}

function Get-Sha256Bytes {
  param([byte[]]$Value)
  $algorithm = [System.Security.Cryptography.SHA256]::Create()
  try { Write-Output $algorithm.ComputeHash($Value) -NoEnumerate }
  finally { $algorithm.Dispose() }
}

function Try-DecodeTimestampToken {
  param([byte[]]$Bytes, [string]$Path)
  if ($null -eq $Bytes -or $Bytes.Length -lt 2 -or $Bytes[0] -ne 0x30) { return $null }
  $token = New-Object System.Security.Cryptography.Pkcs.SignedCms
  try { $token.Decode((Trim-DerSequence -Bytes $Bytes -Path $Path)) }
  catch {
    # SignedCms.Decode rejects this encoding.
    return $null
  }
  return $token
}

function Decode-TimestampToken {
  param([byte[]]$Bytes, [string]$Path)
  $token = Try-DecodeTimestampToken -Bytes $Bytes -Path $Path
  if ($null -eq $token -and $Bytes.Length -gt 1 -and $Bytes[0] -eq 0x04) {
    $token = Try-DecodeTimestampToken -Bytes (Read-DerElement -Bytes $Bytes -Offset 0).Content -Path $Path
  }
  if ($null -eq $token) { throw "RFC 3161 timestamp token is invalid: $Path" }
  return $token
}

function Test-TimestampTokenSignature {
  param($Token, [string]$Path)
  try { $Token.CheckSignature($true) }
  catch {
    # The bool overload can miss an embedded TSA certificate; the extra-store overload is the same signature check.
    try { $Token.CheckSignature($Token.Certificates, $true) }
    catch { throw "RFC 3161 timestamp token signature is invalid: $Path. $($_.Exception.Message)" }
  }
}

function Read-TstInfo {
  param([byte[]]$Content, [string]$Path)
  if ($null -eq $Content -or $Content.Length -eq 0) { throw "RFC 3161 timestamp token has no TSTInfo: $Path" }
  $bytes = $Content
  if ($bytes[0] -eq 0x04) { $bytes = (Read-DerElement -Bytes $bytes -Offset 0).Content }
  $sequence = Read-DerElement -Bytes $bytes -Offset 0
  if ($sequence.Tag -ne 0x30) { throw "RFC 3161 timestamp token has no TSTInfo: $Path" }
  $fields = Get-DerChildren -Content $sequence.Content
  if ($fields.Count -lt 5 -or $fields[0].Tag -ne 0x02 -or $fields[1].Tag -ne 0x06 -or $fields[2].Tag -ne 0x30 -or $fields[3].Tag -ne 0x02 -or $fields[4].Tag -ne 0x18) {
    throw "RFC 3161 timestamp TSTInfo is invalid: $Path"
  }
  $imprint = Get-DerChildren -Content $fields[2].Content
  if ($imprint.Count -lt 2 -or $imprint[0].Tag -ne 0x30 -or $imprint[1].Tag -ne 0x04) { throw "RFC 3161 timestamp imprint is invalid: $Path" }
  $algorithm = Get-DerChildren -Content $imprint[0].Content
  if ($algorithm.Count -lt 1 -or $algorithm[0].Tag -ne 0x06) { throw "RFC 3161 timestamp imprint is invalid: $Path" }
  $oid = Convert-DerOid -Content $algorithm[0].Content
  if ($oid -ne '2.16.840.1.101.3.4.2.1') { throw "RFC 3161 timestamp hash is $oid, expected SHA-256: $Path" }
  return @{
    GenTime = (Convert-GeneralizedTime -Value ([System.Text.Encoding]::ASCII.GetString($fields[4].Content)))
    HashedMessage = $imprint[1].Content
  }
}

function Resolve-Rfc3161GenTime {
  param([string]$Path)
  $pkcs7 = Get-PeCertificateBytes -Path $Path
  $digest = Get-AuthenticodeEncryptedDigest -Bytes $pkcs7 -Path $Path
  $cms = New-Object System.Security.Cryptography.Pkcs.SignedCms
  $cms.Decode($pkcs7)
  if ($cms.SignerInfos.Count -lt 1) { throw "signature has no signer: $Path" }
  $tokenBytes = $null
  $attributes = $cms.SignerInfos[0].UnsignedAttributes
  if ($null -ne $attributes) {
    foreach ($attribute in $attributes) {
      if ($null -ne $attribute.Oid -and $attribute.Oid.Value -eq '1.3.6.1.4.1.311.3.3.1' -and $attribute.Values.Count -gt 0) {
        $tokenBytes = $attribute.Values[0].RawData
        break
      }
    }
  }
  if ($null -eq $tokenBytes) { throw "signature has no RFC 3161 timestamp token: $Path" }
  $token = Decode-TimestampToken -Bytes $tokenBytes -Path $Path
  Test-TimestampTokenSignature -Token $token -Path $Path
  if ($token.ContentInfo.ContentType.Value -ne '1.2.840.113549.1.9.16.1.4') {
    throw "RFC 3161 timestamp content is $($token.ContentInfo.ContentType.Value): $Path"
  }
  $tst = Read-TstInfo -Content $token.ContentInfo.Content -Path $Path
  if (-not (Test-SameBytes -Left (Get-Sha256Bytes -Value $digest) -Right $tst.HashedMessage)) {
    throw "RFC 3161 timestamp imprint does not match the signature: $Path"
  }
  return $tst.GenTime
}

function Get-AnagoSignatureReport {
  param([string]$Path)
  $signature = Get-AuthenticodeSignature -LiteralPath $Path
  $thumbprint = $null
  $subject = 'none'
  if ($null -ne $signature.SignerCertificate) {
    $thumbprint = $signature.SignerCertificate.Thumbprint
    $subject = $signature.SignerCertificate.Subject
  }
  $genTime = $null
  $timestampValid = $false
  $timestampError = $null
  if ([string]$signature.Status -ne 'NotSigned') {
    try {
      $genTime = Resolve-Rfc3161GenTime -Path $Path
      $timestampValid = $true
    }
    catch { $timestampError = $_.Exception.Message }
  }
  return [pscustomobject]@{
    status = [string]$signature.Status
    thumbprint = $thumbprint
    subject = $subject
    timestampValid = [bool]$timestampValid
    genTime = $genTime
    timestampError = $timestampError
  }
}

Import-AnagoAuthenticodeModules -Stopped 'Verification did not start.'
$PSModuleAutoloadingPreference = 'None'
if ($Json) {
  foreach ($file in $Files) {
    Get-AnagoSignatureReport -Path (Resolve-Path -LiteralPath $file).Path | ConvertTo-Json -Compress
  }
  return
}

if (-not (Test-Path -LiteralPath $CertificateFile -PathType Leaf)) { throw "The signing certificate was not found: $CertificateFile" }
$expectedThumbprint = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new(
  (Resolve-Path -LiteralPath $CertificateFile).Path).Thumbprint
$failed = New-Object System.Collections.Generic.List[string]
foreach ($file in $Files) {
  $path = (Resolve-Path -LiteralPath $file).Path
  $report = Get-AnagoSignatureReport -Path $path
  $timestamp = if ($report.timestampValid) { $report.genTime } else { 'invalid' }
  Write-Output ($path + [Environment]::NewLine + "  status: $($report.status)" + [Environment]::NewLine
    + "  signer: $($report.subject)" + [Environment]::NewLine + "  timestamp: $timestamp")
  # A chain-trusted upstream binary is Valid under another publisher. Only the untrusted self-signed root must be pinned.
  if ($report.status -eq 'Valid') { continue }
  if ($report.status -ne 'UnknownError') {
    [void]$failed.Add("refusing $($report.status) signature: $path")
    continue
  }
  if (-not [string]::Equals([string]$report.thumbprint, $expectedThumbprint, [StringComparison]::OrdinalIgnoreCase)) {
    [void]$failed.Add("wrong signer: $path")
    continue
  }
  if (-not $report.timestampValid) {
    $detail = if ([string]::IsNullOrEmpty([string]$report.timestampError)) { 'missing or invalid RFC 3161 timestamp' } else { [string]$report.timestampError }
    [void]$failed.Add("${detail}: $path")
  }
}
if ($failed.Count -gt 0) { throw ($failed -join '; ') }
Write-Output "verified $($Files.Count) artifact(s)"
