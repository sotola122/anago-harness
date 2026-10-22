import { describe, expect, it } from 'vitest'
import {
  MAX_DIAGNOSTIC_BYTES,
  MAX_DIAGNOSTIC_MESSAGE_BYTES,
  formatDiagnostic,
  maskSecrets,
  truncateUtf8,
} from '../src/diagnostic.ts'

describe('maskSecrets', () => {
  it('masks environment-style assignments, bearer tokens and sk- keys', () => {
    const masked = maskSecrets(
      'CURSOR_API_KEY=super-secret Authorization: Bearer abc.def.ghi key sk-live-1234567890',
    )
    expect(masked).not.toContain('super-secret')
    expect(masked).not.toContain('abc.def.ghi')
    expect(masked).not.toContain('sk-live-1234567890')
    expect(masked).toContain('CURSOR_API_KEY=«redacted»')
    expect(masked).toContain('Bearer «redacted»')
    expect(masked).toContain('sk-«redacted»')
  })

  it('masks vendor-specific key shapes', () => {
    const masked = maskSecrets('ghp_abcdefghijklmnopqrst and AKIAIOSFODNN7EXAMPLE')
    expect(masked).not.toContain('ghp_abcdefghijklmnopqrst')
    expect(masked).not.toContain('AKIAIOSFODNN7EXAMPLE')
  })

  it('masks assignments after a quote, in a URL query and in header form', () => {
    expect(maskSecrets('?api_key=SECRET&scope=read')).toBe('?api_key=«redacted»')
    expect(maskSecrets('X-Api-Key: abc123')).toBe('X-Api-Key: «redacted»')
    expect(maskSecrets('Authorization: Token abc123')).toBe('Authorization: «redacted»')
    expect(maskSecrets('Cookie: sid=xyz')).toBe('Cookie: «redacted»')
    const quoted = maskSecrets('"CURSOR_API_KEY=abc"')
    expect(quoted).toContain('CURSOR_API_KEY=«redacted»')
    expect(quoted).not.toContain('abc')
  })

  it('still masks every credential shape the earlier patterns covered', () => {
    const masked = maskSecrets(
      'Authorization: Bearer abc.def.ghi; sk-live-1234567890; ghp_abcdefghijklmnopqrst; AKIAIOSFODNN7EXAMPLE',
    )
    expect(masked).not.toContain('abc.def.ghi')
    expect(masked).not.toContain('sk-live-1234567890')
    expect(masked).not.toContain('ghp_abcdefghijklmnopqrst')
    expect(masked).not.toContain('AKIAIOSFODNN7EXAMPLE')
    expect(masked).toContain('Bearer «redacted»')
  })

  it('leaves ordinary prose readable so the diagnostic still says something', () => {
    expect(maskSecrets('parse error: unexpected token')).toBe('parse error: unexpected token')
    expect(maskSecrets('exit code: 2')).toBe('exit code: 2')
  })
})

describe('truncateUtf8', () => {
  it('returns short text unchanged and drops nothing for an exact fit', () => {
    expect(truncateUtf8('abc', 3)).toBe('abc')
    expect(truncateUtf8('abcd', 3)).toBe('abc')
  })

  it('never splits a multi-byte code point', () => {
    const text = 'あ'.repeat(10)
    const truncated = truncateUtf8(text, 10)
    expect(Buffer.byteLength(truncated, 'utf8')).toBe(9)
    expect(truncated).toBe('あああ')
    expect(text.startsWith(truncated)).toBe(true)
    expect(truncated).not.toContain('\uFFFD')
  })

  it('handles a budget that lands inside the first code point', () => {
    expect(truncateUtf8('あ', 1)).toBe('')
    expect(truncateUtf8('あ', 2)).toBe('')
    expect(truncateUtf8('あ', 3)).toBe('あ')
    expect(truncateUtf8('aあ', 2)).toBe('a')
  })

  it('returns nothing for a non-positive budget', () => {
    expect(truncateUtf8('abc', 0)).toBe('')
    expect(truncateUtf8('abc', -1)).toBe('')
  })
})

describe('formatDiagnostic', () => {
  it('renders fixed fields and omits absent exit code and signal', () => {
    expect(formatDiagnostic({ stage: 'startup', category: 'executable' })).toBe(
      'subagent-cursor child failure (stage: startup; category: executable)',
    )
    expect(formatDiagnostic({ stage: 'run', category: 'exit-code', exitCode: 3, signal: null })).toBe(
      'subagent-cursor child failure (stage: run; category: exit-code; exit code: 3)',
    )
  })

  it('keeps the whole diagnostic inside the seam byte budget', () => {
    const diagnostic = formatDiagnostic({
      stage: 'run',
      category: 'product-error',
      exitCode: 1,
      signal: 'SIGTERM',
      message: 'あ'.repeat(5000),
    })
    expect(Buffer.byteLength(diagnostic, 'utf8')).toBeLessThanOrEqual(MAX_DIAGNOSTIC_BYTES)
    expect(diagnostic).not.toContain('\uFFFD')
    expect(
      diagnostic.startsWith('subagent-cursor child failure (stage: run; category: product-error'),
    ).toBe(true)
  })

  it('bounds the message field independently of the assembled diagnostic', () => {
    const diagnostic = formatDiagnostic({ stage: 'run', category: 'parse', message: 'x'.repeat(9000) })
    const head = 'subagent-cursor child failure (stage: run; category: parse)'
    expect(diagnostic.startsWith(`${head}: `)).toBe(true)
    const message = diagnostic.slice(head.length + 2)
    expect(Buffer.byteLength(message, 'utf8')).toBeLessThanOrEqual(MAX_DIAGNOSTIC_MESSAGE_BYTES)
  })

  it('masks before truncating so a credential cannot survive as a fragment', () => {
    const diagnostic = formatDiagnostic({
      stage: 'run',
      category: 'product-error',
      message: `prefix ${'a'.repeat(900)} OPENAI_API_KEY=sk-live-abcdefghijklmnop`,
    })
    expect(diagnostic).not.toContain('sk-live-abcdefghijklmnop')
    expect(diagnostic).not.toContain('sk-')
    expect(Buffer.byteLength(diagnostic, 'utf8')).toBeLessThanOrEqual(MAX_DIAGNOSTIC_BYTES)
  })
})
