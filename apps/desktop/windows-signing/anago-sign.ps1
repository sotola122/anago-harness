<#
.SYNOPSIS
Sign Windows files with the Anago Harness self-signed code-signing certificate.

.DESCRIPTION
Loads Microsoft.PowerShell.Security from this interpreter's $PSHOME before SignTool runs, then signs
one or more files with the Windows SDK signtool and an RFC 3161 timestamp. The PFX comes from
ANAGO_WINDOWS_PFX_FILE, or from ANAGO_WINDOWS_PFX_BASE64 decoded into a temporary file that is removed
afterwards; its password comes from ANAGO_PFX_PASSWORD and is never printed. After SignTool exits 0,
anago-verify.ps1 must accept the file. Chain trust is not required, because the self-signed root is
only added to the stores of the people who install the published certificate. -PreflightOnly checks
the module load and does not read the PFX, the password, or SignTool.

.PARAMETER Files
Executables or libraries to sign. Required unless -PreflightOnly is set.

.PARAMETER TimeStampServer
RFC 3161 timestamp server.

.PARAMETER SignTool
signtool.exe to use. The newest Windows SDK signtool is selected when this is omitted.

.PARAMETER PreflightOnly
Load Microsoft.PowerShell.Security from $PSHOME and exit before any signing. A Windows runner can
prove the module-autoload fix with this switch and no signing credentials.

.EXAMPLE
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .\anago-sign.ps1 -PreflightOnly

.EXAMPLE
$env:ANAGO_WINDOWS_PFX_BASE64 = Get-Content -Raw signing.pfx.b64
$env:ANAGO_PFX_PASSWORD = 'secret'
./anago-sign.ps1 -Files 'C:\build\DeepSeek Harness.exe'
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0, ValueFromRemainingArguments = $true)]
  [string[]]$Files,
  [string]$TimeStampServer = 'http://timestamp.digicert.com',
  [string]$SignTool,
  [switch]$PreflightOnly
)

$ErrorActionPreference = 'Stop'
# PowerShell 7's PSModulePath makes Windows PowerShell 5.1 fail to autoload Security. Stay on this interpreter's modules.
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
  # Windows PowerShell 5.1's Import-Module has no -LiteralPath; -Name accepts the manifest path.
  try { $null = Import-Module -Name $manifest -ErrorAction Stop }
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

# Fail here, before the PFX or SignTool, when the Security module cannot be loaded.
Import-AnagoAuthenticodeModules -Stopped 'Signing did not start.'
$PSModuleAutoloadingPreference = 'None'
if ($PreflightOnly) {
  if ($null -ne $Files -and $Files.Count -gt 0) { throw '-PreflightOnly does not sign files. Signing did not start.' }
  # A parse error in the verifier would otherwise surface only after SignTool already signed a file.
  $preflightVerifier = Join-Path $PSScriptRoot 'anago-verify.ps1'
  $verifierErrors = $null
  $null = [System.Management.Automation.Language.Parser]::ParseFile($preflightVerifier, [ref]$null, [ref]$verifierErrors)
  if ($null -ne $verifierErrors -and $verifierErrors.Count -gt 0) {
    $first = $verifierErrors[0]
    $detail = $first.Message + ' at line ' + $first.Extent.StartLineNumber
    throw "anago-verify.ps1 does not parse: $detail. Signing did not start."
  }
  Write-Output "Get-AuthenticodeSignature loaded from $((Get-Command Get-AuthenticodeSignature).Module.Path)"
  return
}
if ($null -eq $Files -or $Files.Count -eq 0) { throw 'Files is required unless -PreflightOnly is set' }

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

$certificateFile = Join-Path $PSScriptRoot 'anago-code-signing.cer'
if (-not (Test-Path -LiteralPath $certificateFile -PathType Leaf)) { throw "The signing certificate was not found: $certificateFile" }
$verifyScript = Join-Path $PSScriptRoot 'anago-verify.ps1'

# The call operator passes each value as one argument, so paths and the password need no shell quoting.
try {
  foreach ($file in $Files) {
    $path = (Resolve-Path -LiteralPath $file).Path
    & $signToolPath sign /f $pfx /p $password /fd sha256 /td sha256 /tr $TimeStampServer $path
    if ($LASTEXITCODE -ne 0) { throw "signtool sign exited with $LASTEXITCODE for $path" }
    & $verifyScript -Files $path -CertificateFile $certificateFile
    Write-Output "signed $path"
  }
}
finally {
  if ($null -ne $temporaryPfx) { Remove-Item -LiteralPath $temporaryPfx -Force -ErrorAction SilentlyContinue }
}
