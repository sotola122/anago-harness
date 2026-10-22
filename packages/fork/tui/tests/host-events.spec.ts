import { describe, expect, it, vi, type Mock } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { projectableSessionEvent, subscribeAgentEvents, type AgentEventSink } from '../src/host/events.ts'
import type { ProjectableTranscriptEvent } from '../src/projection/blocks.ts'

/** The Agent identity the subscriptions filter by. */
const AGENT = { id: 'agent-1', session: { id: SessionId('session-1') } }

/** The transcript event vocabulary, one sample per durable type. */
const PROJECTABLE = [
  { type: 'user/message', seq: 1, time: 1, data: { content: [], source: { kind: 'user' } } },
  { type: 'assistant/message', seq: 2, time: 2, data: { message: { content: [] } } },
  { type: 'tool/call', seq: 3, time: 3, data: { callId: 'call-1', name: 'bash', arguments: '{}' } },
  { type: 'tool/result', seq: 4, time: 4, data: { message: { content: [], source: { callId: 'call-1' } } } },
  { type: 'turn/start', seq: 5, time: 5 },
  { type: 'turn/end', seq: 6, time: 6, data: { reason: { kind: 'completed' } } },
] as const

/**
 * Build a sink whose calls the test inspects.
 * @returns the sink and its spies.
 */
function sink(): AgentEventSink & {
  event: Mock<(event: ProjectableTranscriptEvent) => void>
  delta: Mock<(text: string) => void>
  reasoning: Mock<(text: string) => void>
  status: Mock<(status: 'idle' | 'running') => void>
  error: Mock<(error: unknown) => void>
} {
  return {
    event: vi.fn<(event: ProjectableTranscriptEvent) => void>(),
    delta: vi.fn<(text: string) => void>(),
    reasoning: vi.fn<(text: string) => void>(),
    status: vi.fn<(status: 'idle' | 'running') => void>(),
    error: vi.fn<(error: unknown) => void>(),
  }
}

describe('projectable Session events', () => {
  it('passes the transcript vocabulary through unchanged', () => {
    for (const event of PROJECTABLE) {
      expect(projectableSessionEvent(event as never)).toBe(event)
    }
  })

  it('rewrites a titled Session event and ignores other event types', () => {
    expect(projectableSessionEvent({
      type: 'session/title',
      seq: 7,
      time: 7,
      data: { title: 'Migration' },
    } as never)).toEqual({ type: 'session/title', seq: 7, time: 7, data: { title: 'Migration' } })

    expect(projectableSessionEvent({ type: 'session/title', seq: 8, time: 8, data: {} } as never)).toBeNull()
    expect(projectableSessionEvent({ type: 'session/created', seq: 9, time: 9 } as never)).toBeNull()
  })
})

describe('live Agent subscriptions', () => {
  it('forwards the owned Session events and drops foreign or untracked ones', async () => {
    const ctx = new Context()
    const sink_ = sink()
    const remove = subscribeAgentEvents(ctx, AGENT as never, sink_)

    ctx.emit('session/event', AGENT.session as never, PROJECTABLE[0] as never)
    expect(sink_.event).toHaveBeenLastCalledWith(PROJECTABLE[0])

    ctx.emit('session/event', { id: SessionId('session-2') } as never, PROJECTABLE[1] as never)
    expect(sink_.event).toHaveBeenCalledTimes(1)

    ctx.emit('session/event', AGENT.session as never, { type: 'session/created', seq: 10 } as never)
    expect(sink_.event).toHaveBeenCalledTimes(1)

    ctx.emit('session/event', AGENT.session as never, {
      type: 'session/title',
      seq: 11,
      time: 11,
      data: { title: 'Migration' },
    } as never)
    expect(sink_.event).toHaveBeenLastCalledWith({
      type: 'session/title',
      seq: 11,
      time: 11,
      data: { title: 'Migration' },
    })
    remove()
    await ctx.fiber.dispose()
  })

  it('forwards streamed text and reasoning for the owned Agent only', async () => {
    const ctx = new Context()
    const sink_ = sink()
    const remove = subscribeAgentEvents(ctx, AGENT as never, sink_)

    ctx.emit('agent/assistant-stream', {
      agent: { id: 'agent-2' },
      frame: { type: 'chunk', chunk: { type: 'text-delta', text: 'foreign' } },
    } as never)
    expect(sink_.delta).not.toHaveBeenCalled()

    ctx.emit('agent/assistant-stream', {
      agent: AGENT,
      frame: { type: 'start' },
    } as never)
    expect(sink_.delta).not.toHaveBeenCalled()

    ctx.emit('agent/assistant-stream', {
      agent: AGENT,
      frame: { type: 'chunk', chunk: { type: 'text-delta', text: 'hello' } },
    } as never)
    expect(sink_.delta).toHaveBeenLastCalledWith('hello')

    ctx.emit('agent/assistant-stream', {
      agent: AGENT,
      frame: { type: 'chunk', chunk: { type: 'reasoning-delta', text: 'thinking' } },
    } as never)
    expect(sink_.reasoning).toHaveBeenLastCalledWith('thinking')

    ctx.emit('agent/assistant-stream', {
      agent: AGENT,
      frame: { type: 'chunk', chunk: { type: 'tool-call-delta', text: '' } },
    } as never)
    expect(sink_.delta).toHaveBeenCalledTimes(1)
    expect(sink_.reasoning).toHaveBeenCalledTimes(1)

    remove()
    await ctx.fiber.dispose()
  })

  it('forwards lifecycle and failure events for the owned Agent only', async () => {
    const ctx = new Context()
    const sink_ = sink()
    const remove = subscribeAgentEvents(ctx, AGENT as never, sink_)

    ctx.emit('agent/status', { agent: { id: 'agent-2' }, status: 'running' } as never)
    expect(sink_.status).not.toHaveBeenCalled()
    ctx.emit('agent/status', { agent: AGENT, status: 'running' } as never)
    expect(sink_.status).toHaveBeenLastCalledWith('running')

    const failure = new Error('provider failed')
    ctx.emit('agent/error', { agent: { id: 'agent-2' }, error: failure } as never)
    expect(sink_.error).not.toHaveBeenCalled()
    ctx.emit('agent/error', { agent: AGENT, error: failure } as never)
    expect(sink_.error).toHaveBeenLastCalledWith(failure)

    remove()
    await ctx.fiber.dispose()
  })

  it('detaches every listener when disposed', async () => {
    const ctx = new Context()
    const sink_ = sink()
    const remove = subscribeAgentEvents(ctx, AGENT as never, sink_)

    remove()

    ctx.emit('session/event', AGENT.session as never, PROJECTABLE[0] as never)
    ctx.emit('agent/assistant-stream', {
      agent: AGENT,
      frame: { type: 'chunk', chunk: { type: 'text-delta', text: 'hello' } },
    } as never)
    ctx.emit('agent/status', { agent: AGENT, status: 'idle' } as never)
    ctx.emit('agent/error', { agent: AGENT, error: new Error('late') } as never)

    expect(sink_.event).not.toHaveBeenCalled()
    expect(sink_.delta).not.toHaveBeenCalled()
    expect(sink_.status).not.toHaveBeenCalled()
    expect(sink_.error).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })
})
