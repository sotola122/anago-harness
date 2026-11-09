/** Sign Windows code with the fork's self-signed certificate; the release eToken path stays separate. */

import { execFile } from 'node:child_process'
import { X509Certificate } from 'node:crypto'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { scrubWindowsSigningEnvironment } from './windows-sign.mjs'

const execFileAsync = promisify(execFile)

/** Public DER certificate committed beside the artifacts, installed by users, and used as the signing identity. */
export const ANAGO_SIGNING_CERTIFICATE = fileURLToPath(new URL('../windows-signing/anago-code-signing.cer', import.meta.url))

const SIGN_SCRIPT = fileURLToPath(new URL('../windows-signing/anago-sign.ps1', import.meta.url))
const CODE_SIGNING_EKU = '1.3.6.1.5.5.7.3.3'
const PFX_FILE_ENV = 'DSH_DESKTOP_WINDOWS_PFX_FILE'
const PFX_PASSWORD_ENV = 'DSH_DESKTOP_WINDOWS_PFX_PASSWORD'
const SIGN_TIMEOUT_MS = 300_000

function resolveFile(value, name) {
  const candidate = value?.trim()
  if (!candidate) throw new Error(`${name} must identify the self-signed signing file`)
  let path
  try {
    path = realpathSync(candidate)
    if (!statSync(path).isFile()) throw new Error('not a file')
  }
  catch {
    throw new Error(`${name} is missing or is not a file: ${candidate}`)
  }
  return path
}

function powershellText(value) {
  if (value === undefined || value === null) return ''
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value)
  if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) return buffer.toString('utf16le', 2)
  if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) return buffer.toString('utf8', 3)
  return buffer.toString('utf8')
}

function redactedOutput(value, secrets) {
  let output = powershellText(value)
  for (const secret of secrets) {
    if (secret !== '') output = output.replaceAll(secret, '<redacted>')
  }
  return output.trim()
}

/**
 * Replace a signtool failure with a diagnostic that cannot retain the PFX password.
 *
 * @param {unknown} error Signing script failure.
 * @param {string} path Artifact that failed signing.
 * @param {readonly string[]} secrets Values that must not appear in the diagnostic.
 * @param {'sign' | 'preflight'} [phase] Whether the failure happened before SignTool ran.
 * @returns {Error} Sanitized signing failure without the original error as its cause.
 */
export function createWindowsSelfSigningError(error, path, secrets, phase = 'sign') {
  const record = error !== null && typeof error === 'object' ? error : undefined
  const code = record !== undefined && 'code' in record
    && (typeof record.code === 'number' || typeof record.code === 'string')
    ? ` (exit ${String(record.code)})`
    : ''
  const stderr = record !== undefined && 'stderr' in record ? redactedOutput(record.stderr, secrets) : ''
  const detail = stderr === '' ? '' : `: ${stderr}`
  if (phase === 'preflight') {
    return new Error(`Windows self-signing preflight failed for ${path}${code}${detail}. `
      + 'Microsoft.PowerShell.Security could not be loaded from $PSHOME. Signing did not start.')
  }
  if (/refusing |wrong signer|RFC 3161|Signing did not start/iu.test(stderr)) {
    return new Error(`Windows self-signing verification failed for ${path}${code}${detail}. Signing stopped.`)
  }
  return new Error(`Windows self-signing failed for ${path}${code}${detail}. `
    + 'Signing stopped. Check the self-signed PFX, its password, and the SDK signtool before retrying.')
}

/**
 * Resolve the self-signed identity from packaging settings.
 *
 * @param {NodeJS.ProcessEnv} environment Packaging settings that name the PFX file and its password.
 * @returns {{ certificateFile: string, thumbprint: string, pfxFile: string, password: string }} Committed public identity plus the private PFX inputs.
 */
export function resolveWindowsSelfSignEnvironment(environment) {
  const pfxFile = resolveFile(environment[PFX_FILE_ENV], PFX_FILE_ENV)
  const password = environment[PFX_PASSWORD_ENV]
  if (password === undefined || password === '' || /[\r\n]/u.test(password)) {
    throw new Error(`${PFX_PASSWORD_ENV} must contain the self-signed PFX password without line breaks`)
  }
  const certificateFile = resolveFile(ANAGO_SIGNING_CERTIFICATE, 'Self-signed Windows certificate')
  let certificate
  try {
    certificate = new X509Certificate(readFileSync(certificateFile))
  }
  catch {
    throw new Error(`Self-signed Windows certificate is not a readable DER certificate: ${certificateFile}`)
  }
  if (certificate.ca || !certificate.keyUsage?.includes(CODE_SIGNING_EKU)) {
    throw new Error(`Self-signed Windows certificate must be a non-CA Code Signing certificate: ${certificateFile}`)
  }
  return { certificateFile, thumbprint: certificate.fingerprint.replaceAll(':', ''), pfxFile, password }
}

/**
 * Create the hook that signs one executable with the self-signed PFX through the SDK signtool.
 * The first call loads Microsoft.PowerShell.Security from the interpreter before any file is signed. The password is not passed to that preflight.
 *
 * @param {{ environment: NodeJS.ProcessEnv, pfxFile: string, password: string }} options Packaging environment and validated PFX inputs.
 * @returns {(configuration: { path: string, hash: string, isNest: boolean }) => Promise<void>} Serialized signing hook for the files electron-builder and the runtime PE walk do not sign themselves.
 */
function powershellArgs(scriptArgs) {
  return ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SIGN_SCRIPT, ...scriptArgs]
}

export function createWindowsSelfSigner(options) {
  const secrets = [options.password]
  let pending = Promise.resolve()
  let modulesReady = false
  return (configuration) => {
    pending = pending.then(async () => {
      if (configuration.hash !== 'sha256') {
        throw new Error(`Windows self-signing requires SHA-256, received ${configuration.hash}`)
      }
      if (configuration.isNest) throw new Error('Windows self-signing does not support appended signatures')
      const scrubbed = scrubWindowsSigningEnvironment(options.environment)
      if (!modulesReady) {
        try {
          await execFileAsync('powershell.exe', powershellArgs(['-PreflightOnly']), {
            env: scrubbed, windowsHide: true, timeout: SIGN_TIMEOUT_MS, maxBuffer: 64 * 1024,
          })
        }
        catch (error) {
          throw createWindowsSelfSigningError(error, configuration.path, secrets, 'preflight')
        }
        modulesReady = true
      }
      try {
        await execFileAsync('powershell.exe', powershellArgs(['-Files', configuration.path]), {
          env: { ...scrubbed, ANAGO_WINDOWS_PFX_FILE: options.pfxFile, ANAGO_PFX_PASSWORD: options.password },
          windowsHide: true, timeout: SIGN_TIMEOUT_MS, maxBuffer: 64 * 1024,
        })
      }
      catch (error) {
        throw createWindowsSelfSigningError(error, configuration.path, secrets)
      }
    })
    return pending
  }
}
