/** Read-only following of a Session whose writer is another process. */

import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import {
  SessionPersistenceRevision,
  type SessionHandle,
  type SessionHandleReadOptions,
  type SessionHandleReadResult,
} from '@deepseek-ai/dsh-session-persistence'
import type { SessionObservation } from '@deepseek-ai/dsh-session-query'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { SessionHistoryController } from '../src/history.ts'
import type { SessionFollowFrame } from '../src/types.ts'
import { installSessionReadTestServices } from './test-remote.ts'

const POLL_MS = 5
const TARGET = SessionId('foreign-target')
const TARGET_HEADER: SessionHeader = {
  version: SESSION_FORMAT_VERSION,
  id: TARGET,
  createdAt: 1,
  cwd: '/workspace',
  isSeeded: false,
}

/**
 * One stored Session another process writes, observed through the
 * `SessionPersistence` seam. Every test arms failures after the opening
 * snapshot so only the polling tick sees them.
 */
class ForeignSessionStore {
  /** Current opaque revision; every {@link append} changes it. */
  revision = 0
  /** Stored events, contiguous from seq 0. */
  readonly events: SessionEvent[] = []
  /** `stat` calls. */
  stats = 0
  /** Successful `open` calls. */
  opens = 0
  /** `read` calls, including the opening snapshot read. */
  reads = 0
  /** Handles closed at least once. */
  closes = 0
  /** When set, `stat` rejects. */
  statError: Error | undefined
  /** When set, `open` rejects. */
  openError: Error | undefined
  /** When set, every subsequent `read` rejects. */
  readError: Error | undefined
  /** When set, `stat` reports a missing Session. */
  missing = false
  /** When set, the next close rejects after recording the close. */
  closeError: Error | undefined
  /** When set, `stat` waits for it after signalling {@link statEntered}. */
  statHold: Promise<void> | undefined
  /** Resolved when the next `stat` is entered. */
  statEntered: PromiseWithResolvers<undefined> | undefined
  /** When set, `read` waits for it after signalling {@link readEntered}. */
  readGate: Promise<void> | undefined
  /** Resolved when the next `read` is entered. */
  readEntered: PromiseWithResolvers<undefined> | undefined

  /** @param header - stored header of the followed Session. */
  constructor(readonly header: SessionHeader) {}

  /**
   * Record events another process persisted and change the revision.
   * @param events - appended events, in seq order.
   */
  append(...events: SessionEvent[]): void {
    this.events.push(...events)
    this.revision += 1
  }

  /** The service face mounted as `ctx.sessionPersistence`. */
  readonly service = {
    identity: Symbol('foreign-session-store'),
    stat: async (_sessionId: SessionId) => {
      this.stats += 1
      const entered = this.statEntered
      this.statEntered = undefined
      entered?.resolve(undefined)
      // A backend that ignores cancellation must not open a handle after stop.
      await this.statHold
      if (this.statError !== undefined) throw this.statError
      if (this.missing) return undefined
      return { header: this.header, revision: SessionPersistenceRevision(`foreign:${this.revision}`) }
    },
    open: async () => {
      if (this.openError !== undefined) throw this.openError
      this.opens += 1
      return this.handle()
    },
  }

  /**
   * Wait for one test-controlled gate, or for the read cancellation.
   * @param gate - hold until released; absent to return immediately.
   * @param signal - cancellation that rejects the wait.
   */
  private async gate(gate: Promise<void> | undefined, signal: AbortSignal | undefined): Promise<void> {
    if (gate === undefined) return
    await new Promise<void>((resolve, reject) => {
      signal?.addEventListener('abort', () => { reject(new Error('read aborted')) }, { once: true })
      void gate.then(() => { resolve() })
    })
  }

  /** Open one read handle over the stored log. */
  private handle(): SessionHandle {
    let closing: Promise<void> | undefined
    const handle: SessionHandle = {
      id: this.header.id,
      header: this.header,
      inheritedEventCount: SessionLogOffset(0),
      access: 'read',
      read: async (
        offset = 0,
        length?: number,
        options?: SessionHandleReadOptions,
      ): Promise<SessionHandleReadResult> => {
        this.reads += 1
        const entered = this.readEntered
        this.readEntered = undefined
        entered?.resolve(undefined)
        options?.signal?.throwIfAborted()
        await this.gate(this.readGate, options?.signal)
        options?.signal?.throwIfAborted()
        if (this.readError !== undefined) throw this.readError
        return {
          eventState: 'detached',
          events: this.events.slice(offset, length === undefined ? undefined : offset + length),
        }
      },
      append: () => Promise.reject(new Error('foreign store is read-only')),
      flush: () => Promise.reject(new Error('foreign store is read-only')),
      close: () => closing ??= (() => {
        this.closes += 1
        return this.closeError === undefined ? Promise.resolve() : Promise.reject(this.closeError)
      })(),
      [Symbol.asyncDispose]: () => handle.close(),
    }
    return handle
  }
}

interface Harness {
  readonly ctx: Context
  readonly store: ForeignSessionStore
  readonly history: SessionHistoryController
}

/** Install the services a cold follow needs plus the foreign store double. */
async function harness(
  promote: (observation: SessionObservation) => void =
    (observation) => { observation[Symbol.dispose]() },
): Promise<Harness> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  installSessionReadTestServices(ctx)
  const store = new ForeignSessionStore(TARGET_HEADER)
  ctx.provide('sessionPersistence', store.service as never)
  const history = new SessionHistoryController(ctx, promote, POLL_MS)
  onTestFinished(() => ctx.fiber.dispose())
  return { ctx, store, history }
}

let eventSources = 0

/** Create a live Session in this process only to produce valid durable events. */
function eventSource(ctx: Context): Session {
  eventSources += 1
  return ctx.sessions.create(SessionId(`foreign-event-source-${eventSources}`), {
    meta: { cwd: '/workspace' },
  })
}

/**
 * Append the opening Turn and prompt of a stored Session.
 * @param source - live Session producing the events.
 * @returns the two events in seq order.
 */
function turnPrefix(source: Session): [SessionEvent, SessionEvent] {
  return [
    source.append('turn/start', { turn: 1 }),
    source.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'prompt' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' }),
  ]
}

/** Open a read-only follow and return its iterator after the opening snapshot. */
async function openReadFollow(
  history: SessionHistoryController,
  signal: AbortSignal,
): Promise<AsyncIterator<SessionFollowFrame>> {
  const iterator = history.follow({
    address: { kind: 'session', sessionId: TARGET },
    mode: 'read',
  }, signal)[Symbol.asyncIterator]()
  await expect(iterator.next()).resolves.toMatchObject({
    done: false,
    value: { type: 'snapshot', cursor: 1 },
  })
  return iterator
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }) })
afterEach(() => { vi.useRealTimers() })

describe('read-only foreign follow', () => {
  it('delivers events appended by another process after a revision change', async () => {
    const { ctx, store, history } = await harness()
    const source = eventSource(ctx)
    store.append(...turnPrefix(source))
    const abort = new AbortController()
    const iterator = await openReadFollow(history, abort.signal)

    const waiting = iterator.next()
    await vi.advanceTimersByTimeAsync(POLL_MS)
    // The first tick always reads, repairing an append that raced the snapshot.
    expect(store.opens).toBe(2)
    const opens = store.opens
    const stats = store.stats
    await vi.advanceTimersByTimeAsync(POLL_MS)
    // An unchanged revision costs one stat and no log read.
    expect(store.stats).toBe(stats + 1)
    expect(store.opens).toBe(opens)

    const end = source.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const context = source.append('request/context', { provider: 'fixture', model: 'fixture-model' })
    store.append(end, context)
    await vi.advanceTimersByTimeAsync(POLL_MS)
    await expect(waiting).resolves.toEqual({ done: false, value: { type: 'event', event: end } })
    await expect(iterator.next()).resolves.toEqual({ done: false, value: { type: 'event', event: context } })

    abort.abort()
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not poll while an Agent of this process owns the Session', async () => {
    const { ctx, store, history } = await harness()
    const session = ctx.sessions.create(TARGET, { meta: { cwd: '/workspace' } })
    session.append('turn/start', { turn: 1 })
    await ctx.agents.register({ id: TARGET, session, status: 'idle', ctx } as Agent)
    const abort = new AbortController()
    const iterator = history.follow({
      address: { kind: 'session', sessionId: TARGET },
      mode: 'read',
    }, abort.signal)[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toMatchObject({ value: { type: 'snapshot', cursor: 0 } })

    const waiting = iterator.next()
    await vi.advanceTimersByTimeAsync(POLL_MS * 4)
    expect(store.stats).toBe(0)

    const end = session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await expect(waiting).resolves.toEqual({ done: false, value: { type: 'event', event: end } })
    abort.abort()
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
  })

  it('does not poll in activate mode', async () => {
    const { ctx, store, history } = await harness(vi.fn())
    const source = eventSource(ctx)
    store.append(...turnPrefix(source))
    const abort = new AbortController()
    const iterator = history.follow({
      address: { kind: 'session', sessionId: TARGET },
    }, abort.signal)[Symbol.asyncIterator]()
    // Activate mode reports the display cursor, including the synthetic closer.
    await expect(iterator.next()).resolves.toMatchObject({ value: { type: 'snapshot', cursor: 2 } })

    const waiting = iterator.next()
    await vi.advanceTimersByTimeAsync(POLL_MS * 4)
    // Only the opening observation touched storage.
    expect(store.stats).toBe(1)
    expect(store.opens).toBe(1)

    abort.abort()
    await expect(waiting).resolves.toEqual({ done: true, value: undefined })
  })

  it('stops polling and resumes the in-process source when an Agent attaches', async () => {
    const { ctx, store, history } = await harness()
    const source = eventSource(ctx)
    store.append(...turnPrefix(source))
    const abort = new AbortController()
    const iterator = await openReadFollow(history, abort.signal)

    const waiting = iterator.next()
    await vi.advanceTimersByTimeAsync(POLL_MS)
    const polls = store.stats
    const other = eventSource(ctx)
    await ctx.agents.register({ id: other.id, session: other, status: 'idle', ctx } as Agent)
    await vi.advanceTimersByTimeAsync(POLL_MS)
    // An Agent of another Session leaves the foreign poll running.
    expect(store.stats).toBe(polls + 1)

    const live = ctx.sessions.create(TARGET, { meta: { cwd: '/workspace' }, seed: [...store.events] })
    await ctx.agents.register({ id: TARGET, session: live, status: 'idle', ctx } as Agent)
    const stopped = store.stats
    await vi.advanceTimersByTimeAsync(POLL_MS * 4)
    expect(store.stats).toBe(stopped)

    // The resumed Session replays its seed boundary from the in-process source.
    await expect(waiting).resolves.toMatchObject({
      done: false,
      value: { type: 'event', event: { type: 'session/end-seed', seq: 2 } },
    })
    const end = live.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await expect(iterator.next()).resolves.toEqual({ done: false, value: { type: 'event', event: end } })
    abort.abort()
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([
    ['stat', (store: ForeignSessionStore) => { store.statError = new Error('stat exploded') }],
    ['a missing Session', (store: ForeignSessionStore) => { store.missing = true }],
    ['open', (store: ForeignSessionStore) => { store.openError = new Error('open exploded') }],
    ['read', (store: ForeignSessionStore) => { store.readError = new Error('read exploded') }],
  ])('ends the stream with gateway/internal when %s fails', async (_stage, arm) => {
    const { ctx, store, history } = await harness()
    const source = eventSource(ctx)
    store.append(...turnPrefix(source))
    const abort = new AbortController()
    const iterator = await openReadFollow(history, abort.signal)

    const waiting = iterator.next()
    const failure = expect(waiting).rejects.toMatchObject({ code: 'gateway/internal' })
    arm(store)
    await vi.advanceTimersByTimeAsync(POLL_MS)
    await failure
    // A failed tick schedules nothing, and every opened handle is closed.
    expect(vi.getTimerCount()).toBe(0)
    expect(store.closes).toBe(store.opens)
    expect(abort.signal.aborted).toBe(false)
    expect(ctx.sessions.get(TARGET)).toBeUndefined()
  })

  it('aborts an in-flight poll read and closes its handle', async () => {
    const { ctx, store, history } = await harness()
    const source = eventSource(ctx)
    store.append(...turnPrefix(source))
    const abort = new AbortController()
    const iterator = await openReadFollow(history, abort.signal)

    const entered = Promise.withResolvers<undefined>()
    store.readEntered = entered
    store.readGate = new Promise(() => {})
    const waiting = iterator.next()
    store.append(source.append('turn/end', { turn: 1, reason: { kind: 'completed' } }))
    await vi.advanceTimersByTimeAsync(POLL_MS)
    await entered.promise
    const stats = store.stats

    abort.abort()
    await expect(waiting).resolves.toEqual({ done: true, value: undefined })
    expect(vi.getTimerCount()).toBe(0)
    expect(store.opens).toBe(2)
    expect(store.closes).toBe(2)
    await vi.advanceTimersByTimeAsync(POLL_MS * 4)
    expect(store.stats).toBe(stats)
  })

  it('stops before opening a handle when the follower aborts during stat', async () => {
    const { ctx, store, history } = await harness()
    const source = eventSource(ctx)
    store.append(...turnPrefix(source))
    const abort = new AbortController()
    const iterator = await openReadFollow(history, abort.signal)

    const entered = Promise.withResolvers<undefined>()
    const hold = Promise.withResolvers<undefined>()
    store.statEntered = entered
    store.statHold = hold.promise
    const waiting = iterator.next()
    await vi.advanceTimersByTimeAsync(POLL_MS)
    await entered.promise

    abort.abort()
    hold.resolve(undefined)
    await expect(waiting).resolves.toEqual({ done: true, value: undefined })
    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(store.opens).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reports a handle close failure during abort without failing the stream', async () => {
    const { ctx, store, history } = await harness()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    const source = eventSource(ctx)
    store.append(...turnPrefix(source))
    const abort = new AbortController()
    const iterator = await openReadFollow(history, abort.signal)

    const entered = Promise.withResolvers<undefined>()
    store.readEntered = entered
    store.readGate = new Promise(() => {})
    store.closeError = new Error('close exploded')
    const waiting = iterator.next()
    store.append(source.append('turn/end', { turn: 1, reason: { kind: 'completed' } }))
    await vi.advanceTimersByTimeAsync(POLL_MS)
    await entered.promise

    abort.abort()
    await expect(waiting).resolves.toEqual({ done: true, value: undefined })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('close exploded'))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('suppresses a polled event whose seq already arrived in-process', async () => {
    const { ctx, store, history } = await harness()
    const live = ctx.sessions.create(TARGET, { meta: { cwd: '/workspace' } })
    store.append(...turnPrefix(live))
    const abort = new AbortController()
    const iterator = await openReadFollow(history, abort.signal)

    const waiting = iterator.next()
    await vi.advanceTimersByTimeAsync(POLL_MS)
    const end = live.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await expect(waiting).resolves.toEqual({ done: false, value: { type: 'event', event: end } })

    // The writer's stored log still hands the same seq to the poll.
    store.append(end)
    const reads = store.reads
    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(store.reads).toBe(reads + 1)

    const next = iterator.next()
    const later = live.append('request/context', { provider: 'fixture', model: 'fixture-model' })
    await expect(next).resolves.toEqual({ done: false, value: { type: 'event', event: later } })
    abort.abort()
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
  })
})
