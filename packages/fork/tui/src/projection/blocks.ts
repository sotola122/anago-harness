/**
 * Pure projection from durable Session events to transcript blocks.
 *
 * The renderer never keeps its own conversation state: replay and live updates
 * both fold the same event vocabulary through {@link applyTranscriptEvent}.
 * @module @anago-harness/tui/projection/blocks
 */

import type { ContentBlock, MessageSource } from '@deepseek-ai/dsh-llm'

/** One user turn as displayed. */
export interface UserBlock {
  readonly kind: 'user'
  readonly id: string
  readonly text: string
}

/** One assistant message as displayed. */
export interface AssistantBlock {
  readonly kind: 'assistant'
  readonly id: string
  readonly text: string
  /** True while the model is still streaming into this block. */
  readonly streaming: boolean
}

/** One tool invocation and, once settled, its result. */
export interface ToolBlock {
  readonly kind: 'tool'
  readonly id: string
  readonly name: string
  /** Short human-readable description of the invocation arguments. */
  readonly summary: string
  readonly status: 'running' | 'ok' | 'error'
  /** First line of the result, when one arrived. */
  readonly result?: string
}

/** One error row. */
export interface ErrorBlock {
  readonly kind: 'error'
  readonly id: string
  readonly text: string
}

/** One informational notice. */
export interface NoticeBlock {
  readonly kind: 'notice'
  readonly id: string
  readonly text: string
}

/** A renderable transcript row. */
export type DisplayBlock = UserBlock | AssistantBlock | ToolBlock | ErrorBlock | NoticeBlock

/** Mutable-free projection state consumed by the transcript component. */
export interface TranscriptState {
  readonly blocks: readonly DisplayBlock[]
  /** Text streamed for the in-progress assistant message, before it commits. */
  readonly liveAssistant: string
  /** Highest Session sequence folded so far; later replays skip duplicates. */
  readonly lastSeq: number
  /** Session title from `session/title`, when one was recorded. */
  readonly title: string | null
  /** Whether the Agent is currently driving a turn. */
  readonly status: 'idle' | 'running'
}

/** The event envelope fields the projection needs. */
interface ProjectableEnvelope {
  readonly seq: number
  readonly time: number
}

/** A user message admitted to the durable transcript. */
export interface ProjectableUserMessageEvent extends ProjectableEnvelope {
  readonly type: 'user/message'
  readonly data: {
    readonly content: readonly ContentBlock[]
    readonly source: MessageSource
  }
}

/** A committed assistant message. */
export interface ProjectableAssistantMessageEvent extends ProjectableEnvelope {
  readonly type: 'assistant/message'
  readonly data: {
    readonly message: {
      readonly content: readonly ContentBlock[]
    }
  }
}

/** A committed tool invocation. */
export interface ProjectableToolCallEvent extends ProjectableEnvelope {
  readonly type: 'tool/call'
  readonly data: {
    readonly callId: string
    readonly name: string
    readonly arguments: string
  }
}

/** A committed tool result. */
export interface ProjectableToolResultEvent extends ProjectableEnvelope {
  readonly type: 'tool/result'
  readonly data: {
    readonly message: {
      readonly content: readonly ContentBlock[]
      readonly toolCallId?: string
      readonly source: { readonly callId: string }
      readonly isError?: boolean
    }
    readonly error?: { readonly name: string; readonly code: string; readonly reason?: string }
  }
}

/** The turn opened. */
export interface ProjectableTurnStartEvent extends ProjectableEnvelope {
  readonly type: 'turn/start'
}

/** The turn closed, possibly with a failure. */
export interface ProjectableTurnEndEvent extends ProjectableEnvelope {
  readonly type: 'turn/end'
  readonly data: {
    readonly reason: {
      readonly kind: string
      readonly error?: { readonly message?: string; readonly code?: string }
    }
  }
}

/** The session title changed. */
export interface ProjectableTitleEvent extends ProjectableEnvelope {
  readonly type: 'session/title'
  readonly data: { readonly title: string }
}

/**
 * Every durable event this projection understands. Session events are
 * structurally assignable; unknown event types are ignored by construction.
 */
export type ProjectableTranscriptEvent =
  | ProjectableUserMessageEvent
  | ProjectableAssistantMessageEvent
  | ProjectableToolCallEvent
  | ProjectableToolResultEvent
  | ProjectableTurnStartEvent
  | ProjectableTurnEndEvent
  | ProjectableTitleEvent

/** The empty transcript state. */
export const EMPTY_TRANSCRIPT: TranscriptState = Object.freeze({
  blocks: [],
  liveAssistant: '',
  lastSeq: -1,
  title: null,
  status: 'idle',
})

/**
 * Join the visible text blocks of one message, skipping reasoning.
 * @param content - message content blocks.
 * @returns the text a transcript row shows.
 */
export function contentText(content: readonly ContentBlock[]): string {
  return content
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/**
 * Collapse arbitrary text to one bounded display line.
 * @param text - source text.
 * @param limit - maximum characters to keep.
 * @returns the collapsed and bounded line.
 */
export function summarizeText(text: string, limit = 160): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length <= limit ? collapsed : `${collapsed.slice(0, limit - 1)}…`
}

/**
 * Describe one tool invocation from its raw argument JSON.
 * @param name - tool name.
 * @param rawArguments - JSON string supplied by the model.
 * @returns a short description suitable for a transcript row.
 */
export function summarizeToolCall(name: string, rawArguments: string): string {
  let parsed: Record<string, unknown> | null = null
  try {
    const value: unknown = JSON.parse(rawArguments)
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      parsed = value as Record<string, unknown>
    }
  } catch (error) {
    // Tool arguments may be truncated while streaming; the raw text is still useful.
    if (!(error instanceof SyntaxError)) throw error
  }
  if (parsed !== null) {
    for (const key of ['command', 'cmd', 'path', 'file_path', 'filePath', 'query', 'q', 'pattern', 'url', 'description']) {
      const value = parsed[key]
      if (typeof value === 'string' && value.trim() !== '') return summarizeText(value)
      if (Array.isArray(value) && value.every(item => typeof item === 'string')) {
        return summarizeText(value.join(' '))
      }
    }
  }
  const fallback = rawArguments.trim() === '' ? '' : rawArguments
  return fallback === '' ? name : summarizeText(fallback, 80)
}

/**
 * Fold one durable event into the transcript.
 * @param state - current projection state.
 * @param event - durable Session event.
 * @returns the next state; events at or below `lastSeq` are ignored.
 */
export function applyTranscriptEvent(state: TranscriptState, event: ProjectableTranscriptEvent): TranscriptState {
  if (event.seq <= state.lastSeq) return state
  const seq = event.seq
  switch (event.type) {
    case 'user/message': {
      if (event.data.source.kind !== 'user') return { ...state, lastSeq: seq }
      const text = contentText(event.data.content)
      if (text.trim() === '') return { ...state, lastSeq: seq }
      return {
        ...state,
        lastSeq: seq,
        blocks: [...state.blocks, { kind: 'user', id: `user-${seq}`, text }],
      }
    }
    case 'assistant/message': {
      const text = contentText(event.data.message.content)
      return {
        ...state,
        lastSeq: seq,
        liveAssistant: '',
        blocks: text === ''
          ? state.blocks
          : [...state.blocks, { kind: 'assistant', id: `assistant-${seq}`, text, streaming: false }],
      }
    }
    case 'tool/call':
      return {
        ...state,
        lastSeq: seq,
        blocks: [...state.blocks, {
          kind: 'tool',
          id: `tool-${event.data.callId}`,
          name: event.data.name,
          summary: summarizeToolCall(event.data.name, event.data.arguments),
          status: 'running',
        }],
      }
    case 'tool/result': {
      const callId = event.data.message.source.callId
      const result = summarizeText(contentText(event.data.message.content)) || undefined
      const failed = event.data.error !== undefined || event.data.message.isError === true
      const index = findLastIndex(state.blocks, block => block.kind === 'tool' && block.id === `tool-${callId}`)
      if (index === -1) return { ...state, lastSeq: seq }
      const blocks = [...state.blocks]
      const existing = state.blocks[index]
      if (existing?.kind !== 'tool') return { ...state, lastSeq: seq }
      blocks[index] = { ...existing, status: failed ? 'error' : 'ok', ...result === undefined ? {} : { result } }
      return { ...state, lastSeq: seq, blocks }
    }
    case 'turn/start':
      return { ...state, lastSeq: seq, status: 'running' }
    case 'turn/end': {
      const reason = event.data.reason
      let blocks = state.blocks
      if (reason.kind === 'error') {
        const suffix = reason.error?.code === undefined ? '' : ` (${reason.error.code})`
        blocks = [...state.blocks, {
          kind: 'error',
          id: `error-${seq}`,
          text: `${reason.error?.message ?? 'the turn failed'}${suffix}`,
        }]
      } else if (reason.kind === 'aborted') {
        blocks = [...state.blocks, { kind: 'notice', id: `notice-${seq}`, text: 'turn aborted' }]
      }
      return { ...state, lastSeq: seq, status: 'idle', liveAssistant: '', blocks }
    }
    case 'session/title':
      return { ...state, lastSeq: seq, title: event.data.title }
  }
}

/**
 * Fold a whole event sequence, as replay does on resume.
 * @param events - durable events in order.
 * @returns the final projection state.
 */
export function projectTranscript(events: Iterable<ProjectableTranscriptEvent>): TranscriptState {
  let state = EMPTY_TRANSCRIPT
  for (const event of events) state = applyTranscriptEvent(state, event)
  return state
}

/**
 * Append streamed assistant text to the live row.
 * @param state - current projection state.
 * @param text - delta text.
 * @returns the next state.
 */
export function applyAssistantDelta(state: TranscriptState, text: string): TranscriptState {
  if (text === '') return state
  return { ...state, liveAssistant: state.liveAssistant + text }
}

/**
 * Record a non-durable failure reported by the Agent.
 * @param state - current projection state.
 * @param text - failure description.
 * @returns the next state.
 */
export function addErrorBlock(state: TranscriptState, text: string): TranscriptState {
  return {
    ...state,
    blocks: [...state.blocks, { kind: 'error', id: `error-live-${state.blocks.length}`, text }],
  }
}

/**
 * Record a non-durable informational notice.
 * @param state - current projection state.
 * @param text - notice text.
 * @returns the next state.
 */
export function addNoticeBlock(state: TranscriptState, text: string): TranscriptState {
  return {
    ...state,
    blocks: [...state.blocks, { kind: 'notice', id: `notice-live-${state.blocks.length}`, text }],
  }
}

/**
 * Set the display status without a durable boundary event.
 * @param state - current projection state.
 * @param status - lifecycle state to show.
 * @returns the next state.
 */
export function setTranscriptStatus(state: TranscriptState, status: 'idle' | 'running'): TranscriptState {
  return state.status === status ? state : { ...state, status }
}

/**
 * Find the last index matching a predicate.
 * @param values - values to scan.
 * @param predicate - match test.
 * @returns the last matching index, or -1.
 */
function findLastIndex<T>(values: readonly T[], predicate: (value: T) => boolean): number {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index]
    if (value !== undefined && predicate(value)) return index
  }
  return -1
}
