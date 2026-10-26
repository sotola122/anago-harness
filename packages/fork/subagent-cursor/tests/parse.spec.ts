import { describe, expect, it } from 'vitest'
import { parseOutcome, readCollectedStream, recoverCollectedOutput, textOutput } from '../src/parse.ts'
import type { CollectedStream, RunOutputs } from '../src/parse.ts'
import type { SubprocessOutputReader } from '@deepseek-ai/dsh-subprocess'

function outputs(overrides: Partial<RunOutputs> = {}): RunOutputs {
  return {
    outputFormat: 'json',
    exitCode: 0,
    signal: null,
    stdout: '',
    stdoutComplete: true,
    ...overrides,
  }
}

describe('textOutput', () => {
  it('keeps an empty final text as no blocks', () => {
    expect(textOutput('')).toEqual([])
  })

  it('wraps non-empty text in one text block', () => {
    expect(textOutput('done')).toEqual([{ type: 'text', text: 'done' }])
  })
})

describe('readCollectedStream', () => {
  it('reports an absent stream as empty and complete', () => {
    expect(readCollectedStream(undefined)).toEqual({ text: '', truncated: false })
  })

  it('carries the truncation and spill facts of a lossy read', () => {
    const reader: SubprocessOutputReader = {
      readFrom: () => ({ text: 'tail', nextOffset: 4, lossy: true, spillPath: '/run/stdout.spill' }),
    }
    expect(readCollectedStream(reader)).toEqual({
      text: 'tail',
      truncated: true,
      spillPath: '/run/stdout.spill',
    })
  })
})

describe('recoverCollectedOutput', () => {
  it('returns an untruncated stream as-is', async () => {
    const stream: CollectedStream = { text: '{"a":1}', truncated: false }
    await expect(recoverCollectedOutput(stream, async () => 'unused')).resolves.toEqual({
      text: '{"a":1}',
      complete: true,
    })
  })

  it('re-reads the complete stream from the spill file when truncated', async () => {
    const stream: CollectedStream = { text: 'ta', truncated: true, spillPath: '/run/stdout.spill' }
    const reads: string[] = []
    await expect(
      recoverCollectedOutput(stream, async (path) => {
        reads.push(path)
        return '{"result":"complete"}'
      }),
    ).resolves.toEqual({ text: '{"result":"complete"}', complete: true })
    expect(reads).toEqual(['/run/stdout.spill'])
  })

  it('keeps the retained tail when the spill is gone or unreadable', async () => {
    const noSpill: CollectedStream = { text: 'tail', truncated: true }
    await expect(recoverCollectedOutput(noSpill, async () => 'unused')).resolves.toEqual({
      text: 'tail',
      complete: false,
    })
    const failing: CollectedStream = { text: 'tail', truncated: true, spillPath: '/run/gone' }
    await expect(recoverCollectedOutput(failing, async () => Promise.reject(new Error('ENOENT')))).resolves.toEqual({
      text: 'tail',
      complete: false,
    })
  })
})

describe('parseOutcome with --output-format json', () => {
  it('completes with the payload result field when it is present', () => {
    const result = parseOutcome(outputs({ stdout: '{"result":"final text","is_error":false}' }))
    expect(result).toEqual({ output: [{ type: 'text', text: 'final text' }], stopReason: 'completed' })
  })

  it('completes with the whole collected text when no result field exists', () => {
    // The CLI's JSON schema is unverified: a parseable payload without `result`
    // still completes, and the model sees exactly what the CLI printed.
    const stdout = '{"session_id":"s1","usage":{"input":1}}'
    expect(parseOutcome(outputs({ stdout }))).toEqual({
      output: [{ type: 'text', text: stdout }],
      stopReason: 'completed',
    })
  })

  it('treats a string is_error of "false" as success', () => {
    const result = parseOutcome(outputs({ stdout: '{"is_error":"false","result":"ok"}' }))
    expect(result.stopReason).toBe('completed')
  })

  it('maps is_error to an error with the sanitized product message', () => {
    const result = parseOutcome(
      outputs({ stdout: '{"is_error":true,"result":"failed: API_KEY=abc123 is rejected"}' }),
    )
    expect(result.stopReason).toBe('error')
    expect(result.output).toEqual([
      { type: 'text', text: '{"is_error":true,"result":"failed: API_KEY=abc123 is rejected"}' },
    ])
    expect(result.diagnostic).toContain('category: product-error')
    expect(result.diagnostic).toContain('«redacted»')
    expect(result.diagnostic).not.toContain('abc123')
  })

  it('errors on a broken JSON payload instead of falling back to completed', () => {
    const result = parseOutcome(outputs({ stdout: 'not json at all' }))
    expect(result.stopReason).toBe('error')
    expect(result.diagnostic).toContain('category: parse')
    expect(result.diagnostic).toContain('stdout is not valid JSON')
    expect(result.output).toEqual([{ type: 'text', text: 'not json at all' }])
  })

  it('names truncation when the parse input was only a tail', () => {
    const result = parseOutcome(outputs({ stdout: 'l text"}', stdoutComplete: false }))
    expect(result.stopReason).toBe('error')
    expect(result.diagnostic).toContain('truncated')
  })

  it('errors with structured fields when the exit code is non-zero', () => {
    const result = parseOutcome(outputs({ stdout: '', exitCode: 2 }))
    expect(result).toEqual({
      output: [],
      diagnostic: 'subagent-cursor child failure (stage: run; category: exit-code; exit code: 2)',
      stopReason: 'error',
    })
  })

  it('errors with the terminating signal when the process was signalled', () => {
    const result = parseOutcome(outputs({ stdout: 'partial', exitCode: null, signal: 'SIGKILL' }))
    expect(result.stopReason).toBe('error')
    expect(result.diagnostic).toContain('category: signal')
    expect(result.diagnostic).toContain('signal: SIGKILL')
  })
})

describe('parseOutcome tolerance for unusual JSON payloads', () => {
  it('completes with the raw stdout when the JSON payload is not an object', () => {
    expect(parseOutcome(outputs({ stdout: 'null' }))).toEqual({
      output: [{ type: 'text', text: 'null' }],
      stopReason: 'completed',
    })
    expect(parseOutcome(outputs({ stdout: '42' }))).toEqual({
      output: [{ type: 'text', text: '42' }],
      stopReason: 'completed',
    })
  })

  it('reports the product-error fallback when is_error carries no result', () => {
    const result = parseOutcome(outputs({ stdout: '{"is_error":true}' }))
    expect(result.stopReason).toBe('error')
    expect(result.diagnostic).toContain('without a result message')
  })

  it('treats a whitespace-only result as no product message', () => {
    const result = parseOutcome(outputs({ stdout: '{"is_error":true,"result":"   "}' }))
    expect(result.stopReason).toBe('error')
    expect(result.diagnostic).toContain('without a result message')
  })
})

describe('parseOutcome with --output-format text', () => {
  it('completes with the raw stdout on exit code 0, even when it looks like JSON', () => {
    expect(parseOutcome(outputs({ outputFormat: 'text', stdout: '{"is_error":true}' }))).toEqual({
      output: [{ type: 'text', text: '{"is_error":true}' }],
      stopReason: 'completed',
    })
  })

  it('errors on a non-zero exit code', () => {
    const result = parseOutcome(outputs({ outputFormat: 'text', stdout: 'partial', exitCode: 1 }))
    expect(result.stopReason).toBe('error')
    expect(result.diagnostic).toContain('exit code: 1')
    expect(result.output).toEqual([{ type: 'text', text: 'partial' }])
  })
})
