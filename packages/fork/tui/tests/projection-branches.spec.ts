import { describe, expect, it } from 'vitest'
import {
  applyAssistantDelta,
  applyReasoningDelta,
  applyTranscriptEvent,
  EMPTY_TRANSCRIPT,
  isExpandable,
  projectTranscript,
  toggleLastExpandable,
  type ProjectableTranscriptEvent,
  type TranscriptState,
} from '../src/projection/blocks.ts'

/**
 * Build a user message event.
 * @param seq - durable sequence number.
 * @param text - message text.
 * @returns the event.
 */
function user(seq: number, text: string): ProjectableTranscriptEvent {
  return {
    type: 'user/message',
    seq,
    time: 1,
    data: { content: [{ type: 'text', text }], source: { kind: 'user' } },
  }
}

/**
 * Build a tool-call event.
 * @param seq - durable sequence number.
 * @param callId - tool call id.
 * @param name - tool name.
 * @param raw - raw argument JSON.
 * @returns the event.
 */
function toolCall(seq: number, callId: string, name: string, raw: string): ProjectableTranscriptEvent {
  return { type: 'tool/call', seq, time: 1, data: { callId, name, arguments: raw } }
}

/**
 * Build a tool-result event.
 * @param seq - durable sequence number.
 * @param data - the result event body.
 * @returns the event.
 */
function toolResult(
  seq: number,
  data: {
    readonly callId: string
    readonly text?: string
    readonly failed?: boolean
    readonly meta?: unknown
    readonly reason?: string
  },
): ProjectableTranscriptEvent {
  return {
    type: 'tool/result',
    seq,
    time: 1,
    data: {
      message: {
        content: [{ type: 'text', text: data.text ?? '' }],
        source: { callId: data.callId },
        isError: data.failed === true,
      },
      ...data.meta === undefined ? {} : { meta: data.meta },
      ...data.reason === undefined ? {} : { error: { name: 'ToolError', code: 'FAILED', reason: data.reason } },
    },
  }
}

describe('transcript projection edge cases', () => {
  it('advances past user messages that carry no visible text', () => {
    const state = projectTranscript([user(0, ' \n ')])

    expect(state.blocks).toHaveLength(0)
    expect(state.lastSeq).toBe(0)
  })

  it('keeps a reasoning-only assistant message without an assistant row', () => {
    const state = projectTranscript([{
      type: 'assistant/message',
      seq: 0,
      time: 1,
      data: { message: { content: [{ type: 'reasoning', text: 'Only thinking.' }] } },
    }])

    expect(state.blocks).toEqual([{ kind: 'reasoning', id: 'reasoning-0', text: 'Only thinking.', expanded: false }])
  })

  it('keeps the previous blocks when an assistant message carries nothing', () => {
    const before = projectTranscript([user(0, 'hi')])

    const after = applyTranscriptEvent(before, {
      type: 'assistant/message',
      seq: 1,
      time: 2,
      data: { message: { content: [] } },
    })

    expect(after.blocks).toBe(before.blocks)
    expect(after.lastSeq).toBe(1)
  })

  it('shows the command as a detail line when the call carries a description', () => {
    const state = projectTranscript([
      toolCall(0, 'call-1', 'bash', JSON.stringify({ command: 'ls -la', description: 'List files' })),
    ])

    expect(state.blocks[0]).toMatchObject({ kind: 'tool', summary: 'List files', detail: '$ ls -la' })
  })

  it('ignores a result whose call is unknown to the transcript', () => {
    const before = projectTranscript([toolCall(0, 'call-1', 'bash', JSON.stringify({ command: 'ls' }))])

    const after = applyTranscriptEvent(before, toolResult(1, { callId: 'call-2', text: 'orphan' }))

    expect(after.blocks).toBe(before.blocks)
    expect(after.lastSeq).toBe(1)
  })

  it('marks a failed result and keeps the recorded failure reason', () => {
    const state = projectTranscript([
      toolCall(0, 'call-1', 'bash', JSON.stringify({ command: 'false' })),
      toolResult(1, { callId: 'call-1', failed: true, reason: 'the command exited 1' }),
    ])

    expect(state.blocks[0]).toMatchObject({
      kind: 'tool',
      status: 'error',
      result: 'the command exited 1',
    })
  })

  it('records a turn error without a code and one without a message', () => {
    const withoutCode = projectTranscript([
      { type: 'turn/end', seq: 0, time: 1, data: { reason: { kind: 'error', error: { message: 'slow down' } } } },
    ])
    expect(withoutCode.blocks.at(-1)).toMatchObject({ kind: 'error', text: 'slow down' })

    const withoutMessage = projectTranscript([
      { type: 'turn/end', seq: 0, time: 1, data: { reason: { kind: 'error', error: { code: 'RATE_LIMIT' } } } },
    ])
    expect(withoutMessage.blocks.at(-1)).toMatchObject({ kind: 'error', text: 'the turn failed (RATE_LIMIT)' })
  })

  it('records the Session title from its durable event', () => {
    const state = projectTranscript([
      { type: 'session/title', seq: 0, time: 1, data: { title: 'Migration' } },
    ])

    expect(state.title).toBe('Migration')
    expect(state.lastSeq).toBe(0)
  })

  it('leaves the projection untouched for empty stream deltas', () => {
    const state = projectTranscript([user(0, 'hi')])

    expect(applyAssistantDelta(state, '')).toBe(state)
    expect(applyReasoningDelta(state, '')).toBe(state)
  })
})

describe('expandable cards', () => {
  it('treats a tool card with facts but no preview as expandable', () => {
    const state = projectTranscript([
      toolCall(0, 'call-1', 'bash', '{}'),
      toolResult(1, { callId: 'call-1', meta: { cwd: '/repo' } }),
    ])
    const block = state.blocks[0]

    expect(block).toMatchObject({ kind: 'tool', result: 'no output', output: '', facts: ['cwd /repo'] })
    expect(block !== undefined && isExpandable(block)).toBe(true)
    expect(toggleLastExpandable(state).blocks[0]).toMatchObject({ expanded: true })
  })

  it('does not treat a completed tool card without detail as expandable', () => {
    const state: TranscriptState = {
      ...EMPTY_TRANSCRIPT,
      blocks: [{
        kind: 'tool',
        id: 'tool-call-1',
        callId: 'call-1',
        name: 'bash',
        summary: 'ls',
        status: 'ok',
        facts: [],
        startedAt: 0,
        expanded: false,
      }],
    }

    expect(toggleLastExpandable(state)).toBe(state)
  })
})
