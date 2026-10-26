import { describe, expect, it } from 'vitest'
import { MAX_DIAGNOSTIC_BYTES } from '../src/diagnostic.ts'
import { PiJsonlStream } from '../src/parse.ts'

/** One assistant message_end event. */
function assistantEnd(message: Record<string, unknown>): string {
  return JSON.stringify({ type: 'message_end', message: { role: 'assistant', ...message } })
}

/** Exit facts with a normal zero exit. */
const EXIT_OK = { exitCode: 0, signal: null } as const

/**
 * Feed complete lines (newline-terminated) into a fresh stream.
 * @param lines - raw protocol lines.
 * @returns the finished stream.
 */
function streamOf(lines: readonly string[]): PiJsonlStream {
  const stream = new PiJsonlStream()
  for (const line of lines) stream.push(`${line}\n`)
  stream.end()
  return stream
}

describe('PiJsonlStream success mapping', () => {
  it('maps assistant text blocks and ignores thinking blocks', () => {
    const stream = streamOf([
      '{"type":"session","version":3}',
      '{"type":"agent_start"}',
      '{"type":"message_start","message":{"role":"assistant","content":[]}}',
      assistantEnd({
        content: [
          { type: 'thinking', thinking: 'private reasoning' },
          { type: 'text', text: 'first paragraph' },
          { type: 'text', text: 'second paragraph' },
        ],
        stopReason: 'stop',
      }),
      '{"type":"agent_end","messages":[],"willRetry":false}',
      '{"type":"agent_settled","aborted":false}',
    ])
    expect(stream.output()).toEqual([
      { type: 'text', text: 'first paragraph' },
      { type: 'text', text: 'second paragraph' },
    ])
    expect(stream.outcome(EXIT_OK)).toEqual({
      output: [{ type: 'text', text: 'first paragraph' }, { type: 'text', text: 'second paragraph' }],
      stopReason: 'completed',
    })
  })

  it('keeps the last assistant message as the final answer', () => {
    const stream = streamOf([
      assistantEnd({ content: [{ type: 'text', text: 'intermediate' }], stopReason: 'toolUse' }),
      assistantEnd({ content: [{ type: 'text', text: 'final answer' }], stopReason: 'stop' }),
    ])
    expect(stream.output()).toEqual([{ type: 'text', text: 'final answer' }])
    expect(stream.outcome(EXIT_OK).stopReason).toBe('completed')
  })

  it('treats an absent stop reason as success', () => {
    const stream = streamOf([assistantEnd({ content: [{ type: 'text', text: 'answer' }] })])
    expect(stream.outcome(EXIT_OK)).toEqual({
      output: [{ type: 'text', text: 'answer' }],
      stopReason: 'completed',
    })
  })

  it('completes an empty final message without inventing output', () => {
    const stream = streamOf([assistantEnd({ content: [], stopReason: 'stop' })])
    expect(stream.outcome(EXIT_OK)).toEqual({ output: [], stopReason: 'completed' })
  })

  it('keeps the last non-empty assistant message when the final one is empty', () => {
    const stream = streamOf([
      assistantEnd({ content: [{ type: 'text', text: 'earlier answer' }], stopReason: 'stop' }),
      assistantEnd({ content: [{ type: 'thinking', thinking: 'reasoning only' }], stopReason: 'stop' }),
    ])
    expect(stream.output()).toEqual([{ type: 'text', text: 'earlier answer' }])
  })

  it('joins a line split across chunks and flushes a trailing line', () => {
    const stream = new PiJsonlStream()
    const line = assistantEnd({ content: [{ type: 'text', text: 'split answer' }], stopReason: 'stop' })
    stream.push(line.slice(0, 20))
    stream.push(line.slice(20))
    // The final line arrives without its trailing newline.
    stream.end()
    expect(stream.output()).toEqual([{ type: 'text', text: 'split answer' }])
  })
})

describe('PiJsonlStream failure mapping', () => {
  it('maps a stream error stop reason to an error with a masked message', () => {
    const stream = streamOf([
      assistantEnd({
        content: [{ type: 'text', text: 'partial' }],
        stopReason: 'error',
        errorMessage: '429 Too Many Requests: OPENAI_API_KEY=sk-secret-value',
      }),
      '{"type":"agent_settled","aborted":false}',
    ])
    const result = stream.outcome(EXIT_OK)
    expect(result.stopReason).toBe('error')
    expect(result.output).toEqual([{ type: 'text', text: 'partial' }])
    expect(result.diagnostic).toContain('category: model-error')
    expect(result.diagnostic).toContain('429 Too Many Requests')
    expect(result.diagnostic).not.toContain('sk-secret-value')
  })

  it('reports an error stop reason that carries no message', () => {
    const stream = streamOf([assistantEnd({ content: [], stopReason: 'error' })])
    expect(stream.outcome(EXIT_OK).diagnostic).toContain('reported an error without a message')
  })

  it('maps the token ceiling to max-tokens for either spelling', () => {
    for (const stopReason of ['length', 'max-tokens']) {
      const stream = streamOf([
        assistantEnd({ content: [{ type: 'text', text: 'cut off' }], stopReason }),
      ])
      expect(stream.outcome(EXIT_OK)).toEqual({
        output: [{ type: 'text', text: 'cut off' }],
        stopReason: 'max-tokens',
      })
    }
  })

  it('maps a model aborted stop reason and a settled abort to aborted', () => {
    const modelAbort = streamOf([
      assistantEnd({ content: [{ type: 'text', text: 'partial' }], stopReason: 'aborted' }),
    ])
    expect(modelAbort.outcome(EXIT_OK)).toEqual({
      output: [{ type: 'text', text: 'partial' }],
      stopReason: 'aborted',
    })

    const settledAbort = streamOf([
      assistantEnd({ content: [{ type: 'text', text: 'partial' }], stopReason: 'stop' }),
      '{"type":"agent_settled","aborted":true}',
    ])
    expect(settledAbort.outcome(EXIT_OK)).toEqual({
      output: [{ type: 'text', text: 'partial' }],
      stopReason: 'aborted',
    })
  })

  it('maps an unrecognized stop reason to a bounded error', () => {
    const stream = streamOf([
      assistantEnd({ content: [], stopReason: 'deferred' }),
    ])
    const result = stream.outcome(EXIT_OK)
    expect(result.stopReason).toBe('error')
    expect(result.diagnostic).toContain('category: stop-reason')
    expect(result.diagnostic).toContain('"deferred"')
  })

  it('maps a non-zero exit without an assistant message to exit-code', () => {
    const stream = streamOf(['{"type":"session","version":3}'])
    const result = stream.outcome({ exitCode: 2, signal: null })
    expect(result.stopReason).toBe('error')
    expect(result.diagnostic).toBe(
      'subagent-pi child failure (stage: run; category: exit-code; exit code: 2): the child exited without an assistant message',
    )
  })

  it('maps a signalled exit without an assistant message to signal', () => {
    const stream = streamOf([])
    const result = stream.outcome({ exitCode: null, signal: 'SIGKILL' })
    expect(result.diagnostic).toContain('category: signal')
    expect(result.diagnostic).toContain('signal: SIGKILL')
  })

  it('maps a clean exit without an assistant message to a protocol error', () => {
    const stream = streamOf(['{"type":"agent_settled","aborted":false}'])
    const result = stream.outcome(EXIT_OK)
    expect(result.stopReason).toBe('error')
    expect(result.diagnostic).toContain('produced no assistant message')
  })

  it('fails closed on an unparseable line even when a later answer arrives', () => {
    const stream = streamOf([
      'not json at all',
      assistantEnd({ content: [{ type: 'text', text: 'answer' }], stopReason: 'stop' }),
    ])
    const result = stream.outcome(EXIT_OK)
    expect(result.stopReason).toBe('error')
    expect(result.diagnostic).toContain('category: protocol')
    expect(result.diagnostic).toContain('1 unparseable JSONL line(s)')
    expect(result.output).toEqual([{ type: 'text', text: 'answer' }])
  })

  it('fails closed on a malformed assistant message', () => {
    const stream = streamOf([
      '{"type":"message_end","message":{"role":"assistant","content":"not-an-array"}}',
    ])
    expect(stream.outcome(EXIT_OK).diagnostic).toContain('category: protocol')
  })

  it('bounds a huge model error message to the seam diagnostic budget', () => {
    const stream = streamOf([
      assistantEnd({
        content: [],
        stopReason: 'error',
        errorMessage: 'x'.repeat(MAX_DIAGNOSTIC_BYTES * 2),
      }),
    ])
    const diagnostic = stream.outcome(EXIT_OK).diagnostic ?? ''
    expect(Buffer.byteLength(diagnostic, 'utf8')).toBeLessThanOrEqual(MAX_DIAGNOSTIC_BYTES)
  })
})

describe('PiJsonlStream tolerant framing', () => {
  it('skips blank and whitespace-only lines between events', () => {
    const stream = new PiJsonlStream()
    stream.push('\n\r\n   \n')
    stream.push(`${assistantEnd({ content: [{ type: 'text', text: 'answer' }], stopReason: 'stop' })}\n`)
    stream.end()
    expect(stream.output()).toEqual([{ type: 'text', text: 'answer' }])
    expect(stream.outcome(EXIT_OK).stopReason).toBe('completed')
  })

  it.each([
    ['a JSON null', 'null'],
    ['a JSON array', '[1]'],
    ['a record without a type', '{"kind":"message_end"}'],
    ['a record whose type is not a string', '{"type":1}'],
  ])('counts %s as a malformed line', (_title, line) => {
    const stream = streamOf([line, assistantEnd({ content: [{ type: 'text', text: 'ok' }] })])
    const result = stream.outcome(EXIT_OK)
    expect(result.stopReason).toBe('error')
    expect(result.diagnostic).toContain('1 unparseable JSONL line(s)')
  })

  it.each([
    ['no message', '{"type":"message_end"}'],
    ['a non-record message', '{"type":"message_end","message":"text"}'],
    ['a message without a role', '{"type":"message_end","message":{"content":[]}}'],
    ['a message whose role is not a string', '{"type":"message_end","message":{"role":1,"content":[]}}'],
  ])('counts a message_end with %s as malformed', (_title, line) => {
    const stream = streamOf([line, assistantEnd({ content: [{ type: 'text', text: 'ok' }] })])
    const result = stream.outcome(EXIT_OK)
    expect(result.stopReason).toBe('error')
    expect(result.diagnostic).toContain('category: protocol')
  })

  it('ignores the message_end of a non-assistant role', () => {
    const stream = streamOf([
      '{"type":"message_end","message":{"role":"user","content":[{"type":"text","text":"prompt"}]}}',
      assistantEnd({ content: [{ type: 'text', text: 'answer' }], stopReason: 'stop' }),
    ])
    expect(stream.output()).toEqual([{ type: 'text', text: 'answer' }])
    expect(stream.outcome(EXIT_OK).stopReason).toBe('completed')
  })
})
