/** Self-sign preflight runs before SignTool and cannot retain the PFX password. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import { createWindowsSelfSigner, createWindowsSelfSigningError } from '../scripts/windows-self-sign.mjs'

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
