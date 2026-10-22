/**
 * DSH event subscriptions feeding the transcript and status line.
 * @module @anago-harness/tui/host/events
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectableTranscriptEvent } from '../projection/blocks.ts'

/** What the live Agent publishes to the UI. */
export interface AgentEventSink {
  /** One durable Session event, already narrowed to a projectable type. */
  event(event: ProjectableTranscriptEvent): void
  /** Streamed assistant text. */
  delta(text: string): void
  /** Agent lifecycle transition. */
  status(status: 'idle' | 'running'): void
  /** A failure that has no in-turn durable record. */
  error(error: unknown): void
}

/**
 * Narrow a Session event to the transcript vocabulary.
 * @param event - any durable Session event.
 * @returns the projectable event, or `null` when the transcript ignores the type.
 */
export function projectableSessionEvent(event: SessionEvent): ProjectableTranscriptEvent | null {
  // `session/title` is declared by a package this row does not depend on, so it
  // is read structurally rather than through the SessionEventMap augmentation.
  const title = event as {
    readonly type: string
    readonly seq: number
    readonly time: number
    readonly data?: { readonly title?: unknown }
  }
  if (title.type === 'session/title' && typeof title.data?.title === 'string') {
    return { type: 'session/title', seq: title.seq, time: title.time, data: { title: title.data.title } }
  }
  switch (event.type) {
    case 'user/message':
    case 'assistant/message':
    case 'tool/call':
    case 'tool/result':
    case 'turn/start':
    case 'turn/end':
      return event
    default:
      return null
  }
}

/**
 * Subscribe the UI to one Agent's durable and live events.
 *
 * Session events are process-global, so listeners filter by Session identity;
 * the Agent-scoped events also compare the exact Agent.
 * @param ctx - plugin context.
 * @param agent - the Agent this UI owns.
 * @param sink - transcript and status receiver.
 */
export function subscribeAgentEvents(ctx: Context, agent: Agent, sink: AgentEventSink): void {
  ctx.on('session/event', (session, event) => {
    if (session.id !== agent.session.id) return
    const projectable = projectableSessionEvent(event)
    if (projectable !== null) sink.event(projectable)
  }, { global: true })

  ctx.on('agent/assistant-stream', (payload) => {
    if (payload.agent.id !== agent.id) return
    const frame = payload.frame
    if (frame.type !== 'chunk' || frame.chunk.type !== 'text-delta') return
    sink.delta(frame.chunk.text)
  }, { global: true })

  ctx.on('agent/status', (payload) => {
    if (payload.agent.id !== agent.id) return
    sink.status(payload.status)
  }, { global: true })

  ctx.on('agent/error', (payload) => {
    if (payload.agent.id !== agent.id) return
    sink.error(payload.error)
  }, { global: true })
}
