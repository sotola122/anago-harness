/** Shared Session history pagination, address validation, wire conversion, and read-only foreign follow. */

import type { Context } from '@deepseek-ai/cordis'
import { Deque } from '@deepseek-ai/dsh-deque'
import type { AssistantStreamFrame } from '@deepseek-ai/dsh-agent'
import { errorChain } from '@deepseek-ai/dsh-llm'
import {
  isAppendSurfaceEvent,
  SessionLogOffset,
  SessionSeq,
} from '@deepseek-ai/dsh-session'
import type {
  SessionEvent,
  SessionHeader,
  SessionId,
  SessionLogOffset as SessionLogOffsetType,
  SessionSeqCursor,
} from '@deepseek-ai/dsh-session'
import type { SessionHandle, SessionPersistenceRevision } from '@deepseek-ai/dsh-session-persistence'
import { SessionQueryError, type SessionObservation } from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-subagent'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type {
  SessionAddress,
  SessionAssistantStreamFrame,
  SessionEventEntry,
  SessionFollowFrame,
  SessionFollowRequest,
  SessionHistoryRecord,
  SessionPageRequest,
  SessionProjectionBaseline,
  SessionProjectionValues,
  SessionWireEvent,
  SessionWireHeader,
} from './types.ts'
import { SessionAssistantStreamAccumulator } from './assistant-stream.ts'

/** Message budget applied when a history request omits `maxMessages`. */
export const DEFAULT_MAX_MESSAGES = 50
const MESSAGE_TYPES = new Set(['user/message', 'assistant/message'])

/**
 * Reject an invalid message budget or turn window.
 * @param request - history window fields.
 */
export function validateHistoryWindow(request: Pick<SessionPageRequest, 'maxMessages' | 'turnWindow'>): void {
  if (request.maxMessages !== undefined
    && (!Number.isSafeInteger(request.maxMessages) || request.maxMessages <= 0)) {
    throw new RemoteError('gateway/bad-request', 'maxMessages must be a positive safe integer', {})
  }
  const window = request.turnWindow
  if (window !== undefined) {
    if (!Number.isSafeInteger(window.minMessages) || window.minMessages <= 0
      || window.minMessages > (request.maxMessages ?? DEFAULT_MAX_MESSAGES)) {
      throw new RemoteError('gateway/bad-request', 'turnWindow.minMessages must be a positive safe integer no greater than maxMessages', {})
    }
    if (!Number.isSafeInteger(window.minTurns) || window.minTurns <= 0) {
      throw new RemoteError('gateway/bad-request', 'turnWindow.minTurns must be a positive safe integer', {})
    }
  }
}

/**
 * Select the Session whose log an address names.
 * @param address - ordinary Session or direct-subagent address.
 * @returns the Session whose log the address reads.
 */
export function addressId(address: SessionAddress): SessionId {
  return address.kind === 'session' ? address.sessionId : address.childSessionId
}

/**
 * Reject an address that does not match the observed Session.
 * @param address - ordinary Session or direct-subagent address.
 * @param header - observed Session header.
 * @param inheritedEventCount - observed fork-inherited event count.
 * @param projections - observed projections; subagent addresses require them.
 */
export function validateAddress(
  address: SessionAddress,
  header: SessionHeader,
  inheritedEventCount: SessionLogOffsetType,
  projections: SessionObservation['projections'],
): void {
  if (address.kind === 'session') {
    if (header.origin === 'subagent') {
      throw new RemoteError('session/agent-busy', 'subagent Sessions require their durable parent address', {
        reason: 'use subagent delivery for this child session',
      })
    }
    return
  }
  if (header.origin !== 'subagent' || header.parentSession !== address.parentSessionId) {
    throw new RemoteError('subagent/unauthorized', 'subagent does not belong to the supplied parent', {
      childSessionId: address.childSessionId,
    })
  }
  const identity = projections?.values.subagent
  if (identity === null) {
    throw new RemoteError('subagent/catalog-diagnostic', 'subagent descriptor is corrupt', {
      parentSessionId: address.parentSessionId,
      childSessionId: address.childSessionId,
      reason: 'corrupt',
    })
  }
  if (identity === undefined || identity.seq < inheritedEventCount) {
    throw new RemoteError('subagent/catalog-diagnostic', 'subagent descriptor is unavailable', {
      parentSessionId: address.parentSessionId,
      childSessionId: address.childSessionId,
      reason: 'unsupported',
    })
  }
  if (address.mode !== 'unknown' && identity.mode !== address.mode) {
    throw new RemoteError('subagent/unauthorized', 'subagent mode does not match the supplied address', {
      childSessionId: address.childSessionId,
    })
  }
}

/**
 * Reject a missing Session using its address-specific error.
 * @param address - ordinary Session or direct-subagent address.
 * @returns never; this operation always throws.
 * @throws RemoteError `session/not-found` or `subagent/not-found`.
 */
export function rejectNotFound(address: SessionAddress): never {
  if (address.kind === 'session') {
    throw new RemoteError('session/not-found', `session "${address.sessionId}" not found`, { sessionId: address.sessionId })
  }
  throw new RemoteError('subagent/not-found', 'subagent is unavailable', {
    parentSessionId: address.parentSessionId,
    childSessionId: address.childSessionId,
  })
}

/**
 * Cut one message-aligned backwards page from a contiguous event prefix.
 * @param events - contiguous events starting at seq 0.
 * @param beforeSeq - exclusive upper offset of an older page.
 * @param maxMessages - message budget.
 * @param throughSeq - inclusive log cut.
 * @param turnWindow - optional turn-boundary stop rule.
 * @returns the page events and whether older events remain.
 */
export function paginate(
  events: readonly SessionEvent[],
  beforeSeq: SessionLogOffsetType | undefined,
  maxMessages: number,
  throughSeq: SessionSeqCursor,
  turnWindow?: SessionPageRequest['turnWindow'],
): { readonly events: SessionEvent[]; readonly hasMore: boolean } {
  const end = SessionLogOffset(Math.min(throughSeq + 1, beforeSeq ?? throughSeq + 1))
  let count = 0
  let turns = 0
  let cut = SessionLogOffset(0)
  for (let index = end - 1; index >= 0; index--) {
    const event = events[index] as SessionEvent
    if (turnWindow !== undefined && event.type === 'turn/start') {
      turns++
      if (count >= turnWindow.minMessages && turns >= turnWindow.minTurns) {
        cut = SessionLogOffset(index)
        break
      }
    }
    if (!MESSAGE_TYPES.has(event.type) || !isAppendSurfaceEvent(event)) continue
    count++
    const sources = event.sourceEventSeqs
    let groupStart = event.seq
    if (sources !== undefined) {
      for (const source of sources) {
        if (source < groupStart) groupStart = source
      }
    }
    if (count >= maxMessages) {
      cut = SessionLogOffset(groupStart)
      break
    }
  }
  return { events: events.slice(cut, end), hasMore: cut > 0 }
}

/**
 * Convert a committed event to its wire entry.
 * @param event - committed Session event.
 * @returns the wire event entry.
 */
export function entryFor(event: SessionEvent): SessionEventEntry {
  return {
    type: 'event',
    // Session.append validates and freezes event data as JSON before publication.
    event: event as unknown as SessionWireEvent,
  }
}

/**
 * Encode one bounded logical page without changing its pagination cut.
 * @param events - page events.
 * @returns the wire records.
 */
export function pageRecords(events: readonly SessionEvent[]): SessionHistoryRecord[] {
  return events.map(entryFor)
}

/** Default milliseconds between foreign-follower revision polls; the Session Controller Config uses it as its schema default. */
export const DEFAULT_FOREIGN_POLL_MS = 500

/**
 * Read-only and activating follow used by foreign-writer observation.
 *
 * The Session Controller delegates `mode: 'read'` here. An activating follow
 * remains available for direct construction; the Web controller owns the
 * activating Remote path.
 */
export class SessionHistoryController {
  private readonly closeFollowers = new Set<() => void>()
  private readonly assistantStreams = new Map<SessionId, SessionAssistantStreamAccumulator>()

  /**
   * @param ctx - Host context carrying Session query and projection services.
   * @param promote - starts ordinary Session activation after snapshot delivery.
   * @param foreignPollMs - positive milliseconds between persistence revision
   *   polls for a read-only follower whose writer is another process; direct
   *   construction outside the Controller keeps the deployment default.
   */
  constructor(
    private readonly ctx: Context,
    private readonly promote: (observation: SessionObservation) => void,
    private readonly foreignPollMs: number = DEFAULT_FOREIGN_POLL_MS,
  ) {
    ctx.on('agent/assistant-stream', ({ agent, frame }) => {
      let stream = this.assistantStreams.get(agent.session.id)
      if (stream === undefined) {
        stream = new SessionAssistantStreamAccumulator()
        this.assistantStreams.set(agent.session.id, stream)
      }
      stream.accept(frame, cursorBeforeNext(agent.session.seq))
    }, { global: true })
    ctx.on('agent/disposed', ({ agent }) => {
      this.assistantStreams.delete(agent.session.id)
    }, { global: true })
    ctx.effect(() => () => {
      for (const close of this.closeFollowers) close()
      this.closeFollowers.clear()
    }, 'session-controller.history')
  }

  /**
   * Follow events appended after an initial cursor on one durable address.
   *
   * An `activate` follow promotes a prepared Session and then reads live
   * `session/event` publications. A `read` follow never promotes it: when no
   * Agent of this process owns the Session, its appends reach this stream by
   * polling the stored log's revision at the configured interval, because the
   * writer publishes no in-process event here.
   * @param request - durable address, `read`/`activate` mode, and last committed sequence already held by the caller.
   * @param signal - stream cancellation owned by the Remote carrier.
   * @returns a complete opening snapshot followed by gap-free durable events and opted-in assistant frames.
   * @throws {RemoteError} `gateway/internal` when a foreign polling stat, open, or read fails; the Client reconnects.
   */
  async *follow(request: SessionFollowRequest, signal: AbortSignal): AsyncIterable<SessionFollowFrame> {
    validateHistoryWindow(request)
    const { address } = request
    const target = addressId(address)
    const buffered = new Deque<
      | { readonly type: 'event'; readonly event: SessionEvent }
      | {
        readonly type: 'assistant-stream'
        readonly frame: SessionAssistantStreamFrame
        readonly ordinal: number
      }
    >()
    let snapshotCursor: SessionSeqCursor | undefined
    let stopForeignPoll: (() => void) | undefined
    let assistantStreamOrdinal = 0
    let wake: (() => void) | undefined
    const notify = (): void => {
      const resume = wake
      wake = undefined
      resume?.()
    }
    const follower = { closed: false }
    const close = (): void => {
      follower.closed = true
      notify()
    }
    this.closeFollowers.add(close)
    const disposeEvent = this.ctx.on('session/event', (session, event) => {
      if (session.id !== target) return
      buffered.pushBack({ type: 'event', event })
      notify()
    }, { global: true })
    const disposeCreated = this.ctx.on('session/created', (session) => {
      if (session.id !== target) return
      // Constructor seed events have no session/event notification. Normally
      // only the end-seed suffix is new; if persistence advanced after the
      // opening observation, replay everything beyond that snapshot cursor.
      // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
      const suffix = session.snapshotEvents(snapshotCursor === undefined
        ? session.firstLiveSeq
        : SessionLogOffset(snapshotCursor + 1))
      for (let index = suffix.length - 1; index >= 0; index -= 1) {
        buffered.pushFront({ type: 'event', event: suffix[index] as SessionEvent })
      }
      notify()
    }, { global: true })
    const disposeAssistantStream = request.assistantStream !== true
      ? undefined
      : this.ctx.on('agent/assistant-stream', ({ agent, frame }) => {
        if (agent.session.id !== target) return
        buffered.pushBack({
          type: 'assistant-stream',
          frame: wireAssistantStreamFrame(frame, cursorBeforeNext(agent.session.seq)),
          ordinal: ++assistantStreamOrdinal,
        })
        notify()
      }, { global: true })
    const onAbort = (): void => { notify() }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      const readOnly = request.mode === 'read'
      using source = await this.sourceFor(address, signal, true)
      const events = readOnly
        // A repair closer is a display device, not durable history: a read-only
        // follower starts at the last persisted event so the writer's real
        // event at that seq is still delivered.
        ? source.events.filter(event => event.seq <= source.savedCursor)
        : source.events
      signal.throwIfAborted()
      const cursor = readOnly ? source.savedCursor : source.cursor
      snapshotCursor = cursor
      const page = paginate(events, undefined, request.maxMessages ?? DEFAULT_MAX_MESSAGES, cursor, request.turnWindow)
      const assistantStream = request.assistantStream === true
        ? this.assistantStreams.get(target)?.snapshot() ?? { revision: 0 }
        : undefined
      // The accumulator snapshot and this watermark are synchronous. Frames
      // through the cut are represented or superseded by that baseline,
      // including larger revisions from a retired Agent; later revision
      // resets reach Client continuity validation.
      const assistantStreamOrdinalCut = assistantStreamOrdinal
      yield {
        type: 'snapshot',
        header: wireHeader(source.header),
        cursor,
        records: pageRecords(page.events),
        hasMore: page.hasMore,
        projections: source.projections === undefined
          ? { asOfSeq: cursor, values: {} }
          : projectionBlock(source.projections),
        ...assistantStream === undefined ? {} : { assistantStream },
      }
      // Viewing must not take the Session's writer lease: activation is an
      // explicit non-read follow, and a read-only follower stays passive even
      // when the caller also set `activate`.
      if (!readOnly && address.kind === 'session' && source.source === 'prepared') {
        const promotion = source.retain()
        try {
          this.promote(promotion)
        } catch (error: unknown) {
          promotion[Symbol.dispose]()
          throw error
        }
      }
      let nextOffset = SessionLogOffset(cursor + 1)
      // A Session written by another process publishes nothing here. Keep
      // polling its stored revision until this process gains an Agent for it
      // or the follow ends; delivered duplicates are dropped by the seq guard.
      let pollFailure: RemoteError | undefined
      stopForeignPoll = !readOnly || this.ctx.agents.get(target) !== undefined
        ? undefined
        : this.pollForeign(target, nextOffset, (event) => {
          buffered.pushBack({ type: 'event', event })
          notify()
        }, (error) => {
          pollFailure = error
          notify()
        })
      while (!follower.closed && !signal.aborted) {
        const item = buffered.popFront()
        if (item === undefined) {
          if (pollFailure !== undefined) throw pollFailure
          await new Promise<void>((resolve) => { wake = resolve })
          continue
        }
        if (item.type === 'assistant-stream') {
          if (item.ordinal > assistantStreamOrdinalCut) {
            yield { type: 'assistant-stream', frame: item.frame }
          }
          continue
        }
        const expectedSeq = SessionSeq(nextOffset)
        if (item.event.seq < expectedSeq) continue
        if (item.event.seq !== expectedSeq) {
          throw new RemoteError('gateway/internal', `session event stream skipped seq ${String(expectedSeq)}`, {})
        }
        nextOffset = SessionLogOffset(nextOffset + 1)
        yield entryFor(item.event)
      }
    } finally {
      this.closeFollowers.delete(close)
      signal.removeEventListener('abort', onAbort)
      disposeCreated()
      disposeEvent()
      disposeAssistantStream?.()
      stopForeignPoll?.()
    }
  }

  /**
   * Poll the stored log of a Session whose writer is another process.
   *
   * Each tick compares the opaque persistence revision with the one it last
   * read and opens a read handle only after a change. The first tick always
   * reads, so an append that races the opening observation is still delivered.
   * A tick is scheduled only after its predecessor settles, so reads never
   * overlap. The poll ends on the returned stop function, which the follow
   * calls when it ends, and by itself when this process gains an Agent for the
   * Session; from then on live events come from the in-process source.
   * @param target - Session the follower reads.
   * @param from - first event seq the follower has not delivered.
   * @param deliver - enqueue one newly persisted event for the follow stream.
   * @param fail - report the `gateway/internal` failure that ends the stream.
   * @returns stop function that clears the pending tick, aborts in-flight
   *   reads, closes an open handle, and stops observing Agent creation.
   */
  private pollForeign(
    target: SessionId,
    from: SessionLogOffsetType,
    deliver: (event: SessionEvent) => void,
    fail: (error: RemoteError) => void,
  ): () => void {
    const persistence = this.ctx.sessionPersistence
    const reads = new AbortController()
    let cursor = from
    let revision: SessionPersistenceRevision | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let handle: SessionHandle | undefined
    let stopped = false
    const stop = (): void => {
      if (stopped) return
      stopped = true
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
      disposeAgentCreated()
      reads.abort()
      const open = handle
      handle = undefined
      open?.close().catch((error: unknown) => {
        this.ctx.logger.warn(`session-controller: closing the read handle of foreign follow "${target}" failed: ${errorChain(error)}`)
      })
    }
    const tick = async (): Promise<void> => {
      try {
        const snapshot = await persistence.stat(target, { signal: reads.signal })
        if (stopped) return
        if (snapshot === undefined) throw new Error('the stored Session no longer exists')
        if (snapshot.revision === revision) {
          schedule()
          return
        }
        revision = snapshot.revision
        const opened = await persistence.open(target, 'read', { signal: reads.signal })
        handle = opened
        try {
          // Aborting between open and read still closes the just-opened handle.
          reads.signal.throwIfAborted()
          const { events } = await opened.read(cursor, undefined, { signal: reads.signal })
          for (const event of events) {
            deliver(event)
            cursor = SessionLogOffset(event.seq + 1)
          }
        } finally {
          handle = undefined
          await opened.close()
        }
        schedule()
      } catch (error: unknown) {
        if (stopped) return
        fail(foreignFollowFailure(target, error))
      }
    }
    const schedule = (): void => {
      timer = setTimeout(() => {
        timer = undefined
        void tick()
      }, this.foreignPollMs)
      timer.unref()
    }
    const disposeAgentCreated = this.ctx.on('agent/created', ({ agent }) => {
      if (agent.id === target) stop()
    }, { global: true })
    schedule()
    return stop
  }

  private async sourceFor(
    address: SessionAddress,
    signal: AbortSignal,
    withProjections: boolean,
  ): Promise<SessionObservation> {
    const sessionId = addressId(address)
    try {
      const observation = await this.ctx.sessionQuery.observeSession(sessionId, {
        signal,
        projectionMode: withProjections || address.kind === 'subagent' ? 'all' : 'none',
      })
      if (observation.header.cwd === undefined) {
        observation[Symbol.dispose]()
        rejectNotFound(address)
      }
      try {
        validateAddress(
          address,
          observation.header,
          observation.inheritedEventCount,
          observation.projections,
        )
      } catch (error: unknown) {
        observation[Symbol.dispose]()
        throw error
      }
      return observation
    } catch (error: unknown) {
      if (error instanceof SessionQueryError
        && error.code === 'SESSION_QUERY_SESSION_NOT_FOUND') rejectNotFound(address)
      throw error
    }
  }
}

function cursorBeforeNext(nextSeq: SessionLogOffsetType): SessionSeqCursor {
  return nextSeq === 0 ? -1 : SessionSeq(nextSeq - 1)
}

/**
 * Map a foreign-follower persistence failure to the one stream failure a
 * Client can act on by reconnecting.
 * @param target - Session being followed.
 * @param error - underlying stat, open, read, or close failure.
 * @returns the `gateway/internal` failure the follow stream throws.
 */
function foreignFollowFailure(target: SessionId, error: unknown): RemoteError {
  return new RemoteError(
    'gateway/internal',
    `read-only follow of session "${target}" failed while polling its writer: ${errorChain(error)}`,
    {},
    { cause: error },
  )
}

function wireAssistantStreamFrame(
  frame: AssistantStreamFrame,
  durableCursor: SessionSeqCursor,
): SessionAssistantStreamFrame {
  if (frame.type === 'start') return { ...frame, startedAfterSeq: durableCursor }
  if (frame.type === 'end') return frame
  return {
    ...frame,
    chunk: frame.chunk as JsonValue,
  }
}

function projectionBlock(
  snapshot: NonNullable<SessionObservation['projections']>,
): SessionProjectionBaseline {
  return {
    asOfSeq: snapshot.asOfSeq,
    // Projection definitions validate whole JSON values before snapshot publication.
    values: snapshot.values as SessionProjectionValues,
  }
}

/** Translate current logical Session metadata to the browser wire. */
function wireHeader(header: SessionHeader): SessionWireHeader {
  return { ...header }
}
