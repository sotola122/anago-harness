/**
 * Pure projection from durable Session events to transcript blocks.
 *
 * The renderer never keeps its own conversation state: replay and live updates
 * both fold the same event vocabulary through {@link applyTranscriptEvent}.
 * @module @anago-harness/tui/projection/blocks
 */

import type { ContentBlock, MessageSource, TokenUsage } from '@deepseek-ai/dsh-llm'
import { describeToolInvocation, summarizeToolResult } from './tools.ts'
import { addUsage, EMPTY_USAGE, type TurnUsage } from './usage.ts'

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

/** One reasoning summary attached to an assistant step. */
export interface ReasoningBlock {
  readonly kind: 'reasoning'
  readonly id: string
  readonly text: string
  /** Whether the full text is shown instead of the preview. */
  readonly expanded: boolean
}

/** One tool invocation and, once settled, its result card. */
export interface ToolBlock {
  readonly kind: 'tool'
  readonly id: string
  /** Tool call identity pairing the call with its result. */
  readonly callId: string
  readonly name: string
  /** Short human-readable description of the invocation arguments. */
  readonly summary: string
  /** Identifying command or path shown beneath the summary. */
  readonly detail?: string
  readonly status: 'running' | 'ok' | 'error'
  /** Collapsed preview of the result, when one arrived. */
  readonly result?: string
  /** Bounded full result text for the expanded view. */
  readonly output?: string
  /** Additional facts extracted from the tool's presentation metadata. */
  readonly facts: readonly string[]
  /** Milliseconds between the call and its result, once settled. */
  readonly durationMs?: number
  /** Session time of the call, used to measure the duration. */
  readonly startedAt: number
  /** Whether the expanded result view is shown. */
  readonly expanded: boolean
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
export type DisplayBlock = UserBlock | AssistantBlock | ReasoningBlock | ToolBlock | ErrorBlock | NoticeBlock

/** Mutable-free projection state consumed by the transcript component. */
export interface TranscriptState {
  readonly blocks: readonly DisplayBlock[]
  /** Text streamed for the in-progress assistant message, before it commits. */
  readonly liveAssistant: string
  /** Reasoning streamed for the in-progress assistant message, before it commits. */
  readonly liveReasoning: string
  /** Highest Session sequence folded so far; later replays skip duplicates. */
  readonly lastSeq: number
  /** Session title from `session/title`, when one was recorded. */
  readonly title: string | null
  /** Whether the Agent is currently driving a turn. */
  readonly status: 'idle' | 'running'
  /** Token totals for the current or most recent turn. */
  readonly usage: TurnUsage
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
    /** Token accounting for this step, when the adapter reported it. */
    readonly usage?: TokenUsage
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
    /** Tool-owned presentation payload recorded with the result. */
    readonly meta?: unknown
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
  liveReasoning: '',
  lastSeq: -1,
  title: null,
  status: 'idle',
  usage: EMPTY_USAGE,
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
 * Join the reasoning blocks of one assistant message.
 * @param content - message content blocks.
 * @returns the reasoning text, or an empty string.
 */
export function contentReasoning(content: readonly ContentBlock[]): string {
  return content
    .filter((block): block is Extract<ContentBlock, { type: 'reasoning' }> => block.type === 'reasoning')
    .map(block => block.text)
    .join('\n')
    .trim()
}

/** Re-exported tool summarizers keep the projection module the single import site. */
export { summarizeText, summarizeToolCall } from './tools.ts'

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
      const reasoning = contentReasoning(event.data.message.content)
      const blocks = [...state.blocks]
      if (reasoning !== '') {
        blocks.push({ kind: 'reasoning', id: `reasoning-${seq}`, text: reasoning, expanded: false })
      }
      if (text !== '') {
        blocks.push({ kind: 'assistant', id: `assistant-${seq}`, text, streaming: false })
      }
      return {
        ...state,
        lastSeq: seq,
        liveAssistant: '',
        liveReasoning: '',
        usage: event.data.usage === undefined ? state.usage : addUsage(state.usage, event.data.usage),
        blocks: blocks.length === state.blocks.length ? state.blocks : blocks,
      }
    }
    case 'tool/call': {
      const invocation = describeToolInvocation(event.data.name, event.data.arguments)
      return {
        ...state,
        lastSeq: seq,
        blocks: [...state.blocks, {
          kind: 'tool',
          id: `tool-${event.data.callId}`,
          callId: event.data.callId,
          name: event.data.name,
          summary: invocation.summary,
          ...invocation.detail === undefined ? {} : { detail: invocation.detail },
          status: 'running',
          facts: [],
          startedAt: event.time,
          expanded: false,
        }],
      }
    }
    case 'tool/result': {
      const callId = event.data.message.source.callId
      const text = contentText(event.data.message.content)
      const failed = event.data.error !== undefined || event.data.message.isError === true
      const index = findLastIndex(state.blocks, block => block.kind === 'tool' && block.id === `tool-${callId}`)
      if (index === -1) return { ...state, lastSeq: seq }
      const blocks = [...state.blocks]
      const existing = state.blocks[index]
      if (existing?.kind !== 'tool') return { ...state, lastSeq: seq }
      const summary = summarizeToolResult({
        name: existing.name,
        text,
        meta: event.data.meta,
        failed,
        errorReason: event.data.error?.reason,
      })
      blocks[index] = {
        ...existing,
        status: failed ? 'error' : 'ok',
        result: summary.preview,
        output: summary.output,
        facts: summary.facts,
        durationMs: Math.max(0, event.time - existing.startedAt),
      }
      return { ...state, lastSeq: seq, blocks }
    }
    case 'turn/start':
      return { ...state, lastSeq: seq, status: 'running', usage: EMPTY_USAGE, liveAssistant: '', liveReasoning: '' }
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
      return { ...state, lastSeq: seq, status: 'idle', liveAssistant: '', liveReasoning: '', blocks }
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
 * Append streamed reasoning text to the live row.
 * @param state - current projection state.
 * @param text - delta text.
 * @returns the next state.
 */
export function applyReasoningDelta(state: TranscriptState, text: string): TranscriptState {
  if (text === '') return state
  return { ...state, liveReasoning: state.liveReasoning + text }
}

/**
 * Clear the conversation while keeping the projection usable for a new Session.
 * @returns the empty projection state.
 */
export function resetTranscript(): TranscriptState {
  return EMPTY_TRANSCRIPT
}

/** Blocks that own a collapsed detail view. */
export type ExpandableBlock = ToolBlock | ReasoningBlock

/**
 * Whether a block carries detail the expanded view would add.
 * @param block - candidate block.
 * @returns true when {@link toggleLastExpandable} can act on it.
 */
export function isExpandable(block: DisplayBlock): block is ExpandableBlock {
  if (block.kind === 'reasoning') return block.text.trim() !== ''
  if (block.kind !== 'tool') return false
  return block.detail !== undefined || (block.output !== undefined && block.output !== '') || block.facts.length > 0
}

/**
 * Toggle the most recent expandable card.
 *
 * The terminal has one expand key rather than per-card focus, so the newest
 * tool or reasoning card is the target; an empty transcript is left unchanged.
 * @param state - current projection state.
 * @returns the next state, or the same state when nothing is expandable.
 */
export function toggleLastExpandable(state: TranscriptState): TranscriptState {
  const index = findLastIndex(state.blocks, isExpandable)
  if (index === -1) return state
  const block = state.blocks[index]
  if (block === undefined || !isExpandable(block)) return state
  const blocks = [...state.blocks]
  blocks[index] = { ...block, expanded: !block.expanded }
  return { ...state, blocks }
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
