/** Inspect runtime signatures and preserve byte-identical copies made by electron-builder. */
import { execFile } from 'node:child_process'
import { lstat, open, readdir, readFile, realpath } from 'node:fs/promises'
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { scrubWindowsSigningEnvironment } from './windows-sign.mjs'
import { recordPackagingEvent } from './packaging-run.mjs'
import { inspectSignaturesBatched } from './windows-signature-batch.mjs'
import { packagingStep } from './packaging-step.mjs'

/**
 * Read Windows trust, timestamp and signer identity using the engine's bundled modules, without accessing the private key.
 * @param {string} path File to inspect.
 * @returns {Promise<{status: string, timestamped: boolean, thumbprint: string | null}>} Authenticode verification result.
 */
export async function inspectWindowsRuntimeSignature(path) {
  // Node can inherit PowerShell 7's module search path while launching Windows PowerShell 5.
  const { stdout, stderr } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '$ErrorActionPreference="Stop"; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); Import-Module "$PSHOME/Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1" -ErrorAction Stop; Import-Module "$PSHOME/Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1" -ErrorAction Stop; $s=Get-AuthenticodeSignature -LiteralPath $env:DSH_RUNTIME_VERIFY_FILE; [pscustomobject]@{status=[string]$s.Status;timestamped=($null -ne $s.TimeStamperCertificate);thumbprint=$s.SignerCertificate.Thumbprint}|ConvertTo-Json -Compress'], {
    env: { ...scrubWindowsSigningEnvironment(process.env), DSH_RUNTIME_VERIFY_FILE: path },
    encoding: 'utf8', windowsHide: true, timeout: 60_000, maxBuffer: 64 * 1024,
  })
  const value = JSON.parse(stdout)
  if (stderr || typeof value !== 'object' || value === null || typeof value.status !== 'string'
    || typeof value.timestamped !== 'boolean'
    || !(value.thumbprint === null || typeof value.thumbprint === 'string' && /^[A-F\d]{40}$/iu.test(value.thumbprint))) {
    throw new Error(`Windows code: invalid signature inspection: ${path}`)
  }
  return { status: value.status, timestamped: value.timestamped, thumbprint: value.thumbprint }
}

/**
 * Preserve a copied runtime executable only after signature and exact-byte verification.
 * @param {string} path Signing-hook target.
 * @param {{sourceRoot: string, destinationRoot: string, runDirectory: string, inspect?: typeof inspectWindowsRuntimeSignature}} options Prepared and copied runtime roots with retained audit directory.
 * @returns {Promise<boolean>} True for a verified runtime copy; false for targets outside that directory.
 */
export async function preserveWindowsRuntimeSignature(path, options) {
  const suffix = relative(options.destinationRoot, path)
  if (!suffix || suffix === '..' || suffix.startsWith(`..${sep}`) || isAbsolute(suffix)) return false
  const source = join(options.sourceRoot, suffix)
  for (const file of [source, path]) {
    if (await realpath(file) !== resolve(file)) throw new Error(`Windows code: linked copy is not signable: ${file}`)
  }
  const [prepared, copied] = await Promise.all([readFile(source), readFile(path)])
  if (!prepared.equals(copied)) throw new Error(`Windows code: copied executable changed: ${path}`)
  const signature = await (options.inspect ?? inspectWindowsRuntimeSignature)(path)
  if (signature.status !== 'Valid') throw new Error(`Windows code: copied signature is ${signature.status}: ${path}`)
  recordPackagingEvent(options.runDirectory, { type: 'primary-runtime-copy-verified', path, ...signature })
  return true
}

/**
 * Enumerate Windows code without following links or treating foreign .node files as PE binaries.
 * @param {string} root - Owned, materialized runtime directory.
 * @returns {Promise<string[]>} Sorted real PE files; eight bounded readers reject links or malformed executables and drain open handles before failure.
 */
export async function windowsRuntimeCode(root) {
  return packagingStep(process.env.DSH_DESKTOP_PACKAGING_RUN_DIR, 'windows:enumerate-code', async () => {
    const candidates = []
    async function collect(directory) {
      const rootStat = await lstat(directory)
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Windows code: expected a real directory')
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name)
        if (entry.isSymbolicLink()) throw new Error(`Windows code: directory links are not signable: ${path}`)
        if (entry.isDirectory()) await collect(path)
        else if (entry.isFile()) candidates.push(path)
      }
    }
    await collect(root)
    return inspectPortableExecutables(candidates)
  })
}

/** Close every active file before returning a sorted inventory or the first inspection failure. */
async function inspectPortableExecutables(candidates) {
  const files = []
  let next = 0
  let failure
  async function inspect(path) {
    const file = await open(path, 'r')
    let portableExecutable = false
    let windowsCandidate = false
    try {
      const header = Buffer.alloc(64)
      const { bytesRead } = await file.read(header, 0, header.length, 0)
      windowsCandidate = bytesRead >= 2 && header.readUInt16LE(0) === 0x5a4d
      if (bytesRead === 64 && windowsCandidate) {
        const signature = Buffer.alloc(4)
        const offset = header.readUInt32LE(0x3c)
        const read = await file.read(signature, 0, 4, offset)
        portableExecutable = offset >= 64 && read.bytesRead === 4 && signature.readUInt32LE(0) === 0x4550
      }
    } finally { await file.close() }
    if (portableExecutable) files.push(path)
    else if (windowsCandidate || ['.exe', '.dll', '.pyd'].includes(extname(path).toLowerCase())) throw new Error(`Windows code: invalid PE file: ${path}`)
  }
  async function worker() {
    while (failure === undefined && next < candidates.length) {
      const path = candidates[next++]
      try { await inspect(path) }
      catch (error) { failure ??= { error } }
    }
  }
  await Promise.all(Array.from({ length: Math.min(8, candidates.length) }, worker))
  if (failure !== undefined) throw failure.error
  return files.sort()
}

/** Drain each public-key verification batch before signing or reporting a failure. */
async function inspectWindowsCode(files, inspect) {
  return packagingStep(process.env.DSH_DESKTOP_PACKAGING_RUN_DIR, 'windows:inspect-signatures',
    () => inspectWindowsCodeBatch(files, inspect))
}

/** Complete bounded inspections without allowing callers to proceed past an active failed batch. */
async function inspectWindowsCodeBatch(files, inspect) {
  if (inspect === inspectWindowsRuntimeSignature) return inspectSignaturesBatched(files)
  const signatures = []
  for (let offset = 0; offset < files.length; offset += 4) {
    const results = await Promise.allSettled(files.slice(offset, offset + 4).map(path => inspect(path)))
    for (const result of results) {
      if (result.status === 'rejected') throw result.reason
      signatures.push(result.value)
    }
  }
  return signatures
}

/**
 * Preserve valid signatures and sign unsigned PE files with a supervised signer.
 * @param {string} root - Owned final runtime directory.
 * @param {import('./windows-runtime-signature.mjs').WindowsCodeSigningOptions} options - Supervised signer, certificate identity, audit sink.
 * @returns {Promise<void>} Resolves after bounded cache restores, batched target verification and sequential hardware signing; failures drain active work before rejecting.
 */
export async function signWindowsCode(root, options) {
  const inspect = options.inspect ?? inspectWindowsRuntimeSignature
  const files = await windowsRuntimeCode(root)
  if (files.length === 0) throw new Error('Windows code: no Windows code found')
  const unsigned = []
  const signatures = await inspectWindowsCode(files, inspect)
  for (const [index, path] of files.entries()) {
    const signature = signatures[index]
    options.record({ type: 'windows-code-signature', path, ...signature })
    if (signature.status === 'NotSigned') unsigned.push(path)
    else if (signature.status !== 'Valid') throw new Error(`Windows code: refusing ${signature.status} signature: ${path}`)
  }
  options.record({ type: 'windows-code-signing-plan', files: files.length, unsigned: unsigned.length })
  async function verifySigned(paths) {
    const verified = await inspectWindowsCode(paths, inspect)
    for (const [index, path] of paths.entries()) {
      const signature = verified[index]
      if (signature.status !== 'Valid' || !signature.timestamped || signature.thumbprint?.toUpperCase() !== options.thumbprint.toUpperCase()) {
        throw new Error(`Windows code: signing verification failed: ${path}`)
      }
      options.record({ type: 'windows-code-signature-verified', path, ...signature })
    }
  }
  const restored = new Set()
  if (options.cache) {
    let next = 0
    let failure
    const worker = async () => {
      while (failure === undefined && next < unsigned.length) {
        const path = unsigned[next++]
        try {
          if (await options.cache.restore({ path, hash: 'sha256', isNest: false })) {
            restored.add(path)
          }
        } catch (error) { failure ??= { error } }
      }
    }
    await Promise.all(Array.from({ length: Math.min(options.cache.concurrency, unsigned.length) }, worker))
    if (failure !== undefined) throw failure.error
    await verifySigned(unsigned.filter(path => restored.has(path)))
  }
  for (const path of unsigned) {
    if (restored.has(path)) continue
    await options.sign({ path, hash: 'sha256', isNest: false })
    await verifySigned([path])
  }
}

/**
 * Reject any unsigned or invalid PE remaining in a completed directory.
 * @param {string} root Materialized artifact directory.
 * @param {typeof inspectWindowsRuntimeSignature} inspect Public-key verifier.
 * @returns {Promise<void>} Resolves after every discovered PE has a valid signature.
 */
export async function verifyWindowsCode(root, inspect = inspectWindowsRuntimeSignature) {
  const files = await windowsRuntimeCode(root)
  if (files.length === 0) throw new Error('Windows code: no Windows code found')
  const signatures = await inspectWindowsCode(files, inspect)
  for (const [index, path] of files.entries()) {
    const signature = signatures[index]
    if (signature.status !== 'Valid') throw new Error(`Windows code: refusing ${signature.status} signature: ${path}`)
  }
}

const VERIFY_SCRIPT = fileURLToPath(new URL('../windows-signing/anago-verify.ps1', import.meta.url))
const GEN_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u

function powershellText(value) {
  if (value === undefined || value === null) return ''
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value)
  if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) return buffer.toString('utf16le', 2)
  if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) return buffer.toString('utf8', 3)
  const text = buffer.toString('utf8')
  return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text
}

function parseSelfSignReport(stdout, stderr, path) {
  if (powershellText(stderr).trim() !== '') throw new Error(`Windows self-sign: invalid signature inspection: ${path}`)
  let value
  try { value = JSON.parse(powershellText(stdout)) }
  catch { throw new Error(`Windows self-sign: invalid signature inspection: ${path}`) }
  if (value === null || typeof value !== 'object' || typeof value.status !== 'string'
    || !(value.thumbprint === null || typeof value.thumbprint === 'string')
    || typeof value.timestampValid !== 'boolean'
    || !(value.genTime === null || typeof value.genTime === 'string')) {
    throw new Error(`Windows self-sign: invalid signature inspection: ${path}`)
  }
  return {
    status: value.status, thumbprint: value.thumbprint, timestampValid: value.timestampValid, genTime: value.genTime,
  }
}

/**
 * Read a self-signed Authenticode report, including the RFC 3161 token result from anago-verify.ps1.
 * UnknownError is not acceptance by itself; the pinned thumbprint and token result still have to pass.
 * @param {string} path File to inspect.
 * @returns {Promise<{status: string, thumbprint: string | null, timestampValid: boolean, genTime: string | null}>} Status, signer thumbprint, and token result.
 */
export async function inspectWindowsSelfSignedSignature(path) {
  const { stdout, stderr } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', VERIFY_SCRIPT, '-Json', '-Files', path], {
    env: scrubWindowsSigningEnvironment(process.env),
    windowsHide: true, timeout: 60_000, maxBuffer: 64 * 1024,
  })
  return parseSelfSignReport(stdout, stderr, path)
}

function assertPinnedSelfSignedSignature(report, thumbprint, path) {
  if (report === null || typeof report !== 'object' || typeof report.status !== 'string' || report.status === '') {
    throw new Error(`Windows self-sign: invalid signature inspection: ${path}`)
  }
  // Electron and other upstream binaries are Valid under their own publisher and carry no pinned token.
  if (report.status === 'Valid') return
  if (report.status !== 'UnknownError') {
    throw new Error(`Windows self-sign: refusing ${report.status} signature: ${path}`)
  }
  if (typeof thumbprint !== 'string' || typeof report.thumbprint !== 'string'
    || report.thumbprint.toUpperCase() !== thumbprint.toUpperCase()) {
    throw new Error(`Windows self-sign: wrong signer: ${path}`)
  }
  if (report.timestampValid !== true || typeof report.genTime !== 'string' || !GEN_TIME.test(report.genTime)) {
    throw new Error(`Windows self-sign: missing or invalid RFC 3161 timestamp: ${path}`)
  }
}

function recordSelfSign(record, type, path, signature) {
  record({
    type, path, status: signature.status, timestamped: signature.timestampValid === true,
    thumbprint: signature.thumbprint, genTime: signature.genTime ?? null,
  })
}

/**
 * Sign unsigned files with the self-signed hook. A Valid signature is accepted as an upstream binary.
 * UnknownError passes only for the pinned certificate and a verified RFC 3161 token.
 * Does not change the eToken requirement that {@link signWindowsCode} accept only Valid.
 * @param {string} root Owned final runtime directory.
 * @param {{ thumbprint: string, sign: (configuration: { path: string, hash: string, isNest: boolean }) => Promise<void>, record: (event: object) => void, inspect?: typeof inspectWindowsSelfSignedSignature }} options Self-sign hook and pinned certificate thumbprint.
 * @returns {Promise<void>} Resolves after every discovered PE passes pinned verification.
 */
export async function signWindowsSelfSignedCode(root, options) {
  const inspect = options.inspect ?? inspectWindowsSelfSignedSignature
  const files = await windowsRuntimeCode(root)
  if (files.length === 0) throw new Error('Windows code: no Windows code found')
  const unsigned = []
  const signatures = await inspectWindowsCode(files, inspect)
  for (const [index, path] of files.entries()) {
    const signature = signatures[index]
    recordSelfSign(options.record, 'windows-code-signature', path, signature)
    if (signature.status === 'NotSigned') unsigned.push(path)
    else assertPinnedSelfSignedSignature(signature, options.thumbprint, path)
  }
  options.record({ type: 'windows-code-signing-plan', files: files.length, unsigned: unsigned.length })
  for (const path of unsigned) {
    await options.sign({ path, hash: 'sha256', isNest: false })
    const verified = await inspect(path)
    assertPinnedSelfSignedSignature(verified, options.thumbprint, path)
    recordSelfSign(options.record, 'windows-code-signature-verified', path, verified)
  }
}

/**
 * Reject any PE that is not a chain-trusted signature or a pinned self-signed signature with a verified RFC 3161 token.
 * @param {string} root Materialized artifact directory.
 * @param {{ thumbprint: string, inspect?: typeof inspectWindowsSelfSignedSignature }} options Pinned certificate thumbprint and optional inspector.
 * @returns {Promise<void>} Resolves after every discovered PE passes pinned verification.
 */
export async function verifyWindowsSelfSignedCode(root, options) {
  const inspect = options.inspect ?? inspectWindowsSelfSignedSignature
  const files = await windowsRuntimeCode(root)
  if (files.length === 0) throw new Error('Windows code: no Windows code found')
  const signatures = await inspectWindowsCode(files, inspect)
  for (const [index, path] of files.entries()) {
    assertPinnedSelfSignedSignature(signatures[index], options.thumbprint, path)
  }
}
