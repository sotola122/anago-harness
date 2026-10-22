import { describe, expect, it } from 'vitest'
import {
  MAX_DIAGNOSTIC_BYTES,
  failureDiagnostic,
  maskSecrets,
  truncateUtf8,
} from '../src/diagnostic.ts'

describe('maskSecrets', () => {
  it('masks assignments, bearer tokens, and vendor-prefixed keys', () => {
    const masked = maskSecrets(
      'PI_API_KEY=super-secret Authorization: Bearer abc.def.ghi key sk-live-1234567890',
    )
    expect(masked).not.toContain('super-secret')
    expect(masked).not.toContain('abc.def.ghi')
    expect(masked).not.toContain('sk-live-1234567890')
    expect(masked).toContain('[redacted]')
  })

  it('masks GitHub key shapes', () => {
    const masked = maskSecrets('ghp_abcdefghijklmnopqrst and github_pat_abcdefghijklmnop')
    expect(masked).not.toContain('ghp_abcdefghijklmnopqrst')
    expect(masked).not.toContain('github_pat_abcdefghijklmnop')
  })

  it('masks a credential header even when the name is hyphenated', () => {
    const masked = maskSecrets('X-Api-Key: abc123')
    expect(masked).not.toContain('abc123')
  })

  it('masks a credential in a URL query value', () => {
    const masked = maskSecrets('https://example.test/v1?api_key=SECRET&scope=read')
    expect(masked).not.toContain('SECRET')
  })

  it('leaves ordinary failure prose readable', () => {
    expect(maskSecrets('429 Too Many Requests')).toBe('429 Too Many Requests')
    expect(maskSecrets('parse error: unexpected token')).toBe('parse error: unexpected token')
  })
})

describe('truncateUtf8', () => {
  it('returns short text unchanged and handles an exact fit', () => {
    expect(truncateUtf8('abc', 3)).toBe('abc')
    expect(truncateUtf8('abc', 4)).toBe('abc')
    expect(truncateUtf8('abc', 0)).toBe('')
  })

  it('never splits a multibyte code point', () => {
    expect(truncateUtf8('ああ', 4)).toBe('あ')
    expect(truncateUtf8('あ', 1)).toBe('')
    expect(truncateUtf8('あい', 6)).toBe('あい')
  })

  it('bounds the encoded byte length of the result', () => {
    for (const maxBytes of [1, 2, 3, 4, 5, 7]) {
      const result = truncateUtf8('あいうえお', maxBytes)
      expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(maxBytes)
    }
  })
})

describe('failureDiagnostic', () => {
  it('renders fixed fields without a message', () => {
    expect(failureDiagnostic({ stage: 'run', category: 'exit-code', exitCode: 2 }))
      .toBe('subagent-pi child failure (stage: run; category: exit-code; exit code: 2)')
  })

  it('includes the stop reason and signal when present', () => {
    const diagnostic = failureDiagnostic({
      stage: 'run',
      category: 'model-error',
      stopReason: 'error',
      signal: 'SIGKILL',
      message: 'the request failed',
    })
    expect(diagnostic).toContain('stop reason: error')
    expect(diagnostic).toContain('signal: SIGKILL')
    expect(diagnostic).toContain(': the request failed')
  })

  it('masks the message and stays within the seam byte budget', () => {
    const diagnostic = failureDiagnostic({
      stage: 'run',
      category: 'model-error',
      message: `PI_API_KEY=super-secret ${'x'.repeat(MAX_DIAGNOSTIC_BYTES * 2)}`,
    })
    expect(diagnostic).not.toContain('super-secret')
    expect(Buffer.byteLength(diagnostic, 'utf8')).toBeLessThanOrEqual(MAX_DIAGNOSTIC_BYTES)
  })

  it('bounds a protocol stop reason quoted into the head', () => {
    const diagnostic = failureDiagnostic({
      stage: 'run',
      category: 'stop-reason',
      stopReason: 'z'.repeat(10_000),
    })
    expect(Buffer.byteLength(diagnostic, 'utf8')).toBeLessThanOrEqual(MAX_DIAGNOSTIC_BYTES)
    expect(diagnostic.length).toBeLessThan(300)
  })
})
