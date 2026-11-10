/** Self-sign preflight runs before SignTool and cannot retain the PFX password. */
import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import { createWindowsSelfSignedPackagerSigner, createWindowsSelfSigner, createWindowsSelfSigningError } from '../scripts/windows-self-sign.mjs'
import { authenticodeArchiveExclusions } from '../scripts/verify-runtime-archive.ts'

const hooks = vi.hoisted(() => ({
  fail: null as null | { code?: number; stderr?: string },
}))

vi.mock('node:child_process', () => ({
  execFile: vi.fn((...invocation: readonly unknown[]) => {
    const callback = invocation[3] as (error: Error | null, result?: { stdout: Buffer; stderr: Buffer }) => void
    if (hooks.fail) {
      callback(Object.assign(new Error('powershell failed'), hooks.fail))
      return
    }
    callback(null, { stdout: Buffer.from('ok'), stderr: Buffer.from('') })
  }),
}))

const { execFile } = await import('node:child_process')
const password = 'super-secret-password'
const file = 'C:\\build\\window-frame.dll'

function signer() {
  return createWindowsSelfSigner({
    environment: { PATH: 'C:\\Windows', DSH_DESKTOP_WINDOWS_PFX_PASSWORD: password, PSModulePath: 'C:\\Program Files\\PowerShell\\7\\Modules' },
    pfxFile: 'C:\\secrets\\anago.pfx',
    password,
  })
}

afterEach(() => {
  hooks.fail = null
  vi.mocked(execFile).mockClear()
})

it('loads the Security module before signing and does not give that preflight the password', async () => {
  await signer()({ path: file, hash: 'sha256', isNest: false })
  const calls = vi.mocked(execFile).mock.calls
  expect(calls).toHaveLength(2)
  expect(calls[0]?.[1]).toEqual(expect.arrayContaining(['-File', expect.stringContaining('anago-sign.ps1'), '-PreflightOnly']))
  expect(calls[0]?.[1]).not.toContain('-Files')
  expect(JSON.stringify(calls[0]?.[2]?.env)).not.toContain(password)
  expect(calls[0]?.[2]?.env).not.toHaveProperty('ANAGO_PFX_PASSWORD')
  expect(calls[1]?.[1]).toEqual(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', expect.stringContaining('anago-sign.ps1'), '-Files', file])
  expect(calls[1]?.[1]?.join(' ')).not.toContain(password)
  expect(calls[1]?.[2]).toMatchObject({ timeout: 300_000, env: { ANAGO_PFX_PASSWORD: password, ANAGO_WINDOWS_PFX_FILE: 'C:\\secrets\\anago.pfx' } })
  expect(calls[1]?.[2]?.env).not.toHaveProperty('DSH_DESKTOP_WINDOWS_PFX_PASSWORD')
})

it('stops before SignTool when the Security module cannot be loaded', async () => {
  hooks.fail = { code: 1, stderr: `CouldNotAutoloadMatchingModule ${password}` }
  const sign = signer()
  const failure = sign({ path: file, hash: 'sha256', isNest: false })
  await expect(failure).rejects.toThrow(/Signing did not start/u)
  await expect(failure).rejects.toThrow('<redacted>')
  await expect(failure).rejects.not.toThrow(password)
  await expect(sign({ path: 'C:\\build\\other.dll', hash: 'sha256', isNest: false })).rejects.toThrow('Signing did not start')
  expect(execFile).toHaveBeenCalledOnce()
  expect(vi.mocked(execFile).mock.calls[0]?.[1]).toContain('-PreflightOnly')
})

it('redacts the password from a SignTool failure and keeps the existing timeout', () => {
  const error = createWindowsSelfSigningError(
    { code: 1, stderr: Buffer.from(`signtool failed ${password}`, 'utf8') },
    file,
    [password],
  )
  expect(error.message).toContain('<redacted>')
  expect(error.message).not.toContain(password)
  expect(error.message).not.toContain('public certificate is trusted')
})

it('imports the interpreter Security module before SignTool and checks the RFC 3161 token', () => {
  const sign = readFileSync(fileURLToPath(new URL('../windows-signing/anago-sign.ps1', import.meta.url)), 'utf8')
  const verify = readFileSync(fileURLToPath(new URL('../windows-signing/anago-verify.ps1', import.meta.url)), 'utf8')
  const preflight = sign.indexOf("Import-AnagoAuthenticodeModules -Stopped 'Signing did not start.'")
  expect(preflight).toBeGreaterThan(-1)
  expect(preflight).toBeLessThan(sign.indexOf('& $signToolPath'))
  expect(sign).toContain('Join-Path $PSHOME')
  const verifyBody = verify.slice(verify.indexOf('#>'))
  expect(verifyBody).not.toContain('TimeStamperCertificate')
  expect(verifyBody).not.toContain('NotBefore')
  expect(verify).toContain('1.3.6.1.4.1.311.3.3.1')
  expect(verify).toContain('UnknownError')
  const acceptValid = verifyBody.indexOf("if ($report.status -eq 'Valid') { continue }")
  expect(acceptValid).toBeGreaterThan(-1)
  expect(acceptValid).toBeLessThan(verifyBody.indexOf('wrong signer'))
  expect(sign).toContain('SetConsoleOutputCP throws IOException')
  expect(verify).toContain('SetConsoleOutputCP throws IOException')
  // A verifier that does not parse must stop the preflight instead of failing after SignTool ran.
  expect(sign.indexOf('ParseFile')).toBeGreaterThan(preflight)
  expect(sign.indexOf('ParseFile')).toBeLessThan(sign.indexOf('& $signToolPath'))
})

const UNINSTALLER = 'deepseek-harness-0.2.2-rc.1-win-x64-self-signed.__uninstaller.exe'

function peBytes(dangling: boolean): Buffer {
  const executable = Buffer.alloc(512)
  const peOffset = 216
  const optionalHeaderOffset = peOffset + 24
  const certificateDirectoryOffset = optionalHeaderOffset + 96 + (4 * 8)
  executable.write('MZ', 0, 'ascii')
  executable.writeUInt32LE(peOffset, 60)
  executable.write('PE\0\0', peOffset, 'ascii')
  executable.writeUInt16LE(0x10B, optionalHeaderOffset)
  if (dangling) {
    executable.writeUInt32LE(600, certificateDirectoryOffset)
    executable.writeUInt32LE(100, certificateDirectoryOffset + 4)
  }
  return executable
}

function certificateDirectory(bytes: Buffer): { offset: number; size: number } {
  const optionalHeaderOffset = bytes.readUInt32LE(60) + 24
  const directory = optionalHeaderOffset + 96 + (4 * 8)
  return { offset: bytes.readUInt32LE(directory), size: bytes.readUInt32LE(directory + 4) }
}

async function withUninstaller(dangling: boolean, action: (path: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-self-sign-uninstaller-'))
  const path = join(directory, UNINSTALLER)
  await writeFile(path, peBytes(dangling))
  try {
    await action(path)
  }
  finally {
    await rm(directory, { recursive: true, force: true })
  }
}

function recordedSigner(sign: (configuration: { path: string; hash: string; isNest: boolean }) => Promise<void>, attempts = 3) {
  const events: Array<Record<string, unknown>> = []
  const lines: string[] = []
  const write = process.stdout.write.bind(process.stdout)
  process.stdout.write = (chunk: string | Uint8Array) => {
    lines.push(String(chunk))
    return true
  }
  const hook = createWindowsSelfSignedPackagerSigner({
    sign,
    secrets: [password],
    uninstallerAttempts: attempts,
    sleep: async () => {},
    record: (event) => { events.push(event as Record<string, unknown>) },
  })
  return {
    hook,
    events,
    lines,
    restore: () => { process.stdout.write = write },
  }
}

it('repairs the extracted uninstaller certificate table and records a signed stub', async () => {
  await withUninstaller(true, async (path) => {
    const seen: number[] = []
    const captured = recordedSigner(async (configuration) => {
      seen.push(certificateDirectory(await readFile(configuration.path)).offset)
    })
    try {
      await captured.hook({ path, hash: 'sha256', isNest: false })
      expect(seen).toEqual([0])
      expect(captured.events).toEqual([expect.objectContaining({
        type: 'nsis-uninstaller', outcome: 'signed', reason: 'ok', repaired: true, dangling: true, attempts: 1, size: 512,
      })])
      expect(captured.lines.join('')).toContain('"outcome":"signed"')
      expect(captured.lines.join('')).not.toContain(password)
    }
    finally {
      captured.restore()
    }
  })
})

it('retries until the uninstaller is a parseable PE, then signs it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-self-sign-uninstaller-'))
  const path = join(directory, UNINSTALLER)
  const signed: string[] = []
  let sleeps = 0
  const events: Array<Record<string, unknown>> = []
  const hook = createWindowsSelfSignedPackagerSigner({
    sign: async (configuration) => { signed.push(configuration.path) },
    uninstallerAttempts: 3,
    sleep: async () => { sleeps += 1; await writeFile(path, peBytes(false)) },
    record: (event) => { events.push(event as Record<string, unknown>) },
  })
  try {
    await hook({ path, hash: 'sha256', isNest: false })
    expect(sleeps).toBe(1)
    expect(signed).toEqual([path])
    expect(events).toEqual([expect.objectContaining({ outcome: 'signed', attempts: 2, repaired: false, dangling: false })])
  }
  finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it('skips an uninstaller that never becomes a PE and does not hang', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-self-sign-uninstaller-'))
  const path = join(directory, UNINSTALLER)
  const signed: string[] = []
  let sleeps = 0
  const events: Array<Record<string, unknown>> = []
  const hook = createWindowsSelfSignedPackagerSigner({
    sign: async () => { signed.push('signed') },
    secrets: [password],
    uninstallerAttempts: 3,
    sleep: async () => { sleeps += 1 },
    record: (event) => { events.push(event as Record<string, unknown>) },
  })
  try {
    await hook({ path, hash: 'sha256', isNest: false })
    expect(sleeps).toBe(2)
    expect(signed).toEqual([])
    expect(events).toEqual([expect.objectContaining({
      outcome: 'skipped', reason: 'not-a-pe', detail: 'missing', attempts: 3, size: 0, repaired: false,
    })])
  }
  finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it('records a SignTool bad-format rejection and still returns so the installer can be signed', async () => {
  await withUninstaller(false, async (path) => {
    const captured = recordedSigner(async () => {
      throw new Error(`SignedCode::Sign returned error: 0x800700C1 ${password}`)
    })
    try {
      await expect(captured.hook({ path, hash: 'sha256', isNest: false })).resolves.toBeUndefined()
      expect(captured.events).toEqual([expect.objectContaining({
        outcome: 'skipped', reason: 'bad-exe-format', detail: '0x800700C1', repaired: false,
      })])
      expect(captured.lines.join('')).not.toContain(password)
      expect(JSON.stringify(captured.events)).not.toContain(password)
    }
    finally {
      captured.restore()
    }
  })
})

it('still fails a non-uninstaller so the installer signature is not skipped', async () => {
  const captured = recordedSigner(async () => { throw new Error(`installer sign failed ${password}`) })
  try {
    await expect(captured.hook({ path: 'C:\\build\\deepseek-harness-setup.exe', hash: 'sha256', isNest: false }))
      .rejects.toThrow(`installer sign failed ${password}`)
    await expect(captured.hook({ path: 'C:\\build\\setup.__uninstaller.exe.bak', hash: 'sha256', isNest: false }))
      .rejects.toThrow('installer sign failed')
    expect(captured.events).toEqual([])
  }
  finally {
    captured.restore()
  }
})

it('gives electron-builder the self-signed hook and not the PFX password', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-self-sign-config-'))
  const pfx = join(directory, 'anago.pfx')
  await writeFile(pfx, 'pfx-fixture')
  try {
    const { createElectronBuilderConfig } = await import('../scripts/electron-builder-config.mjs')
    const config = createElectronBuilderConfig({
      DSH_DESKTOP_APP_ID: 'com.example.self-sign',
      DSH_DESKTOP_TARGET_PLATFORM: 'win32',
      DSH_DESKTOP_SELF_SIGN: '1',
      DSH_DESKTOP_WINDOWS_PFX_FILE: pfx,
      DSH_DESKTOP_WINDOWS_PFX_PASSWORD: password,
      DSH_DESKTOP_PACKAGING_RUN_DIR: directory,
    }, 'linux', 'x64')
    const options = config.win.signtoolOptions
    expect(config.win.forceCodeSigning).toBe(true)
    expect(Object.keys(options).sort()).toEqual(['publisherName', 'sign', 'signingHashAlgorithms'])
    expect(options.signingHashAlgorithms).toEqual(['sha256'])
    expect(typeof options.sign).toBe('function')
    expect(options.sign?.name).toBe('signWindowsSelfSignedPackagerFile')
    expect(options.publisherName).toEqual(expect.stringMatching(/^CN=/u) as string)
    expect(JSON.stringify(config.win)).not.toContain(password)
  }
  finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it('records a completed rewrite so the archive check can skip only that unpacked file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-self-sign-rewrite-'))
  const unpacked = join(directory, 'resources', 'app.asar.unpacked', 'dsh')
  const signed = join(unpacked, 'node_modules', 'foo', 'native.node')
  try {
    const sign = createWindowsSelfSigner({
      environment: {
        PATH: 'C:\\Windows', DSH_DESKTOP_WINDOWS_PFX_PASSWORD: password, DSH_DESKTOP_PACKAGING_RUN_DIR: directory,
      },
      pfxFile: 'C:\\secrets\\anago.pfx', password,
    })
    await sign({ path: signed, hash: 'sha256', isNest: false })
    await sign({ path: join(directory, 'DeepSeek Harness.exe'), hash: 'sha256', isNest: false })
    const recorded = authenticodeArchiveExclusions(await readFile(join(directory, 'events.jsonl'), 'utf8'), unpacked)
    expect(recorded).toEqual({
      exclusions: [{ path: 'node_modules/foo/native.node', reason: 'authenticode-appended' }],
      rewriteRecords: 2,
    })
  }
  finally {
    await rm(directory, { recursive: true, force: true })
  }
})
