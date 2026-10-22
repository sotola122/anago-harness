import { describe, expect, it } from 'vitest'
import {
  addErrorBlock,
  applyAssistantDelta,
  applyTranscriptEvent,
  projectTranscript,
  setTranscriptStatus,
  summarizeToolCall,
  type ProjectableTranscriptEvent,
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
 * @param callId - tool call id.
 * @param text - result text.
 * @param failed - whether the result is an error.
 * @returns the event.
 */
function toolResult(seq: number, callId: string, text: string, failed = false): ProjectableTranscriptEvent {
  return {
    type: 'tool/result',
    seq,
    time: 1,
    data: { message: { content: [{ type: 'text', text }], source: { callId }, isError: failed } },
  }
}

describe('transcript projection', () => {
  it('folds user, tool, assistant, and turn events in order', () => {
    const state = projectTranscript([
      user(0, 'list the files'),
      toolCall(1, 'call-1', 'bash', JSON.stringify({ command: 'ls -la' })),
      toolResult(2, 'call-1', 'a.txt\nb.txt\n'),
      { type: 'assistant/message', seq: 3, time: 2, data: { message: { content: [{ type: 'text', text: 'Two files.' }] } } },
      { type: 'turn/start', seq: 4, time: 2 },
      { type: 'turn/end', seq: 5, time: 3, data: { reason: { kind: 'completed' } } },
    ])

    expect(state.blocks.map(block => block.kind)).toEqual(['user', 'tool', 'assistant'])
    expect(state.blocks[0]).toMatchObject({ kind: 'user', text: 'list the files' })
    expect(state.blocks[1]).toMatchObject({ kind: 'tool', name: 'bash', summary: 'ls -la', status: 'ok', result: 'a.txt b.txt' })
    expect(state.blocks[2]).toMatchObject({ kind: 'assistant', text: 'Two files.', streaming: false })
    expect(state.status).toBe('idle')
  })

  it('streams assistant text until the committed message replaces it', () => {
    let state = projectTranscript([user(0, 'hi')])
    state = applyAssistantDelta(state, 'Hel')
    state = applyAssistantDelta(state, 'lo')
    expect(state.liveAssistant).toBe('Hello')

    state = applyTranscriptEvent(state, {
      type: 'assistant/message',
      seq: 1,
      time: 2,
      data: { message: { content: [{ type: 'text', text: 'Hello' }] } },
    })
    expect(state.liveAssistant).toBe('')
    expect(state.blocks.at(-1)).toMatchObject({ kind: 'assistant', text: 'Hello' })
  })

  it('records durable turn errors and aborted turns', () => {
    const failed = projectTranscript([
      { type: 'turn/start', seq: 0, time: 1 },
      { type: 'turn/end', seq: 1, time: 2, data: { reason: { kind: 'error', error: { code: 'RATE_LIMIT', message: 'slow down' } } } },
    ])
    expect(failed.blocks.at(-1)).toMatchObject({ kind: 'error', text: 'slow down (RATE_LIMIT)' })
    expect(failed.status).toBe('idle')

    const aborted = projectTranscript([
      { type: 'turn/start', seq: 0, time: 1 },
      { type: 'turn/end', seq: 1, time: 2, data: { reason: { kind: 'aborted' } } },
    ])
    expect(aborted.blocks.at(-1)).toMatchObject({ kind: 'notice', text: 'turn aborted' })
  })

  it('ignores duplicate and stale sequence numbers', () => {
    const afterUser = projectTranscript([user(4, 'once')])
    const duplicate = applyTranscriptEvent(afterUser, user(4, 'once'))
    expect(duplicate).toBe(afterUser)
    const stale = applyTranscriptEvent(afterUser, user(3, 'older'))
    expect(stale).toBe(afterUser)
  })

  it('skips context messages whose source is not the human', () => {
    const state = projectTranscript([{
      type: 'user/message',
      seq: 0,
      time: 1,
      data: { content: [{ type: 'text', text: 'injected memory' }], source: { kind: 'memory' } as never },
    }])
    expect(state.blocks).toHaveLength(0)
  })

  it('describes tool arguments by their most useful field', () => {
    expect(summarizeToolCall('bash', JSON.stringify({ command: 'rg TODO src' }))).toBe('rg TODO src')
    expect(summarizeToolCall('read', JSON.stringify({ file_path: '/tmp/a.ts' }))).toBe('/tmp/a.ts')
    expect(summarizeToolCall('search', JSON.stringify({ query: ['alpha', 'beta'] }))).toBe('alpha beta')
    expect(summarizeToolCall('mystery', '{not json')).toBe('{not json')
  })

  it('applies live status and error helpers without touching blocks', () => {
    const running = setTranscriptStatus(projectTranscript([]), 'running')
    expect(running.status).toBe('running')
    const failed = addErrorBlock(running, 'boom')
    expect(failed.blocks.at(-1)).toMatchObject({ kind: 'error', text: 'boom' })
    expect(failed.status).toBe('running')
  })
})
