/**
 * Idle Agent release: a Web Agent hands its Session write ownership back once
 * no work can observe it. Timers drive the timeline, so every assertion waits
 * for the observable effect instead of sleeping.
 */

import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent, AgentHandle, AgentStatus, CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SessionTitleService from '@deepseek-ai/dsh-session-title'
import type { Session, SessionId, UserMessage } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { createSessionTestRemote, type TestSessionRemoteDefaults } from './test-remote.ts'

/** Mutable inbox the release predicate reads through the Agent face. */
interface StubInbox {
  nextTurn: UserMessage[]
  nextStep: UserMessage[]
}

/** One Agent double whose status and inbox the test can change. */
interface StubAgent {
  readonly agent: Agent
  readonly inbox: StubInbox
  setStatus(status: AgentStatus): void
  /** Hold whenIdle() pending to model a maintenance task (manual compaction). */
  setIdleGate(gate: Promise<void> | undefined): void
}

/**
 * Build the Agent face the release predicate reads, plus mutable state.
 * @param ctx - context the Agent claims.
 * @param session - Session the Agent runs.
 * @returns the Agent and its mutators.
 */
function stubAgent(ctx: Context, session: Session): StubAgent {
  const inbox: StubInbox = { nextTurn: [], nextStep: [] }
  let status: AgentStatus = 'idle'
  let idleGate: Promise<void> | undefined
  const agent: Agent = {
    id: session.id,
    options: {},
    session,
    inbox: inbox as never,
    get status() { return status },
    ctx,
    send: () => {},
    followup: () => {},
    model: { current: () => undefined, select: () => {} },
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject: () => {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => idleGate ?? Promise.resolve(),
  }
  return { agent, inbox, setStatus: (next) => { status = next }, setIdleGate: (gate) => { idleGate = gate } }
}

interface Fixture {
  readonly ctx: Context
  readonly remote: Awaited<ReturnType<typeof createSessionTestRemote>>
  readonly dispose: ReturnType<typeof vi.fn>
  readonly agent: StubAgent
  readonly sessionId: SessionId
}

/**
 * Compose a Host whose factory creates one idle Agent and records its disposal.
 * @param overrides - release timeline and optional first-dispose failure.
 * @returns the composed fixture after one Session was created.
 */
async function composed(overrides: Partial<TestSessionRemoteDefaults> & { failFirstDispose?: boolean } = {}): Promise<Fixture> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionTitleService, { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 40 })

  const dispose = vi.fn(async () => {})
  let failuresLeft = overrides.failFirstDispose === true ? 1 : 0
  let created: StubAgent | undefined

  ctx.agents.setFactory({
    createAgent: async (ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle> => {
      const session = ctx.sessions.create(options.sessionId, {
        ...options.meta === undefined ? {} : { meta: options.meta },
      })
      const stub = stubAgent(ownerCtx, session)
      created = stub
      const unregister = await ctx.agents.register(stub.agent)
      return {
        agent: stub.agent,
        dispose: async () => {
          if (failuresLeft > 0) {
            failuresLeft -= 1
            throw new Error('dispose failed on purpose')
          }
          await unregister()
          await dispose()
        },
      }
    },
    resume: () => Promise.reject(new Error('resume must not run in this fixture')),
  })

  const remote = await createSessionTestRemote(ctx, {
    defaultModelSelection: () => ({ provider: 'p', model: 'm' }),
    cwd: '/tmp',
    releaseOnIdle: true,
    releaseIdleDelayMs: 0,
    releaseRetryMs: 10,
    ...overrides,
  })
  const createdValue = await remote.create({ cwd: '/tmp' })
  if (!createdValue.ok) throw new Error(`create failed: ${createdValue.error.message}`)
  if (created === undefined) throw new Error('the factory did not create an Agent')
  return {
    ctx,
    remote,
    dispose,
    sessionId: createdValue.value.sessionId,
    agent: created,
  }
}

describe('idle Agent release', () => {
  it('releases an idle Agent and detaches the Session', async () => {
    const fixture = await composed()
    await vi.waitFor(() => { expect(fixture.dispose).toHaveBeenCalledOnce() })
    expect(fixture.ctx.agents.get(fixture.sessionId)).toBeUndefined()
  })

  it('waits while the Agent is running and releases after it returns to idle', async () => {
    const fixture = await composed()
    fixture.agent.setStatus('running')
    await new Promise(resolve => setTimeout(resolve, 40))
    expect(fixture.dispose).not.toHaveBeenCalled()
    fixture.agent.setStatus('idle')
    await vi.waitFor(() => { expect(fixture.dispose).toHaveBeenCalledOnce() })
  })

  it('waits for a work hold and releases after the holder finishes', async () => {
    const fixture = await composed()
    const hold = fixture.ctx.agents.hold(fixture.agent.agent)
    await new Promise(resolve => setTimeout(resolve, 40))
    expect(fixture.dispose).not.toHaveBeenCalled()
    hold[Symbol.dispose]()
    await vi.waitFor(() => { expect(fixture.dispose).toHaveBeenCalledOnce() })
  })

  it('waits for queued inbox work and releases once it drains', async () => {
    const fixture = await composed()
    fixture.agent.inbox.nextTurn.push({ id: 'queued' } as never)
    await new Promise(resolve => setTimeout(resolve, 40))
    expect(fixture.dispose).not.toHaveBeenCalled()
    fixture.agent.inbox.nextTurn.length = 0
    await vi.waitFor(() => { expect(fixture.dispose).toHaveBeenCalledOnce() })
  })

  it('waits for a live child Agent and releases after the child detaches', async () => {
    const fixture = await composed()
    const childSession = fixture.ctx.sessions.create('child' as SessionId, { meta: { cwd: '/tmp' } })
    const child = stubAgent(fixture.ctx, childSession)
    const detachChild = fixture.ctx.agents.enter(child.agent, fixture.agent.agent)
    await new Promise(resolve => setTimeout(resolve, 40))
    expect(fixture.dispose).not.toHaveBeenCalled()
    detachChild()
    await vi.waitFor(() => { expect(fixture.dispose).toHaveBeenCalledOnce() })
  })

  it('retries after a failed disposal instead of dropping the release', async () => {
    const fixture = await composed({ failFirstDispose: true })
    await vi.waitFor(() => { expect(fixture.dispose).toHaveBeenCalledOnce() }, { timeout: 2000 })
    expect(fixture.ctx.agents.get(fixture.sessionId)).toBeUndefined()
  })

  it('waits for a maintenance task (manual compaction) before releasing', async () => {
    const fixture = await composed()
    const gate = Promise.withResolvers<undefined>()
    fixture.agent.setIdleGate(gate.promise)
    await new Promise(resolve => setTimeout(resolve, 40))
    expect(fixture.dispose).not.toHaveBeenCalled()
    gate.resolve(undefined)
    await vi.waitFor(() => { expect(fixture.dispose).toHaveBeenCalledOnce() })
  })

  it('re-checks quiescence when a maintenance task releases a turn', async () => {
    const fixture = await composed()
    const gate = Promise.withResolvers<undefined>()
    fixture.agent.setIdleGate(gate.promise)
    await new Promise(resolve => setTimeout(resolve, 20))
    fixture.agent.setStatus('running')
    gate.resolve(undefined)
    await new Promise(resolve => setTimeout(resolve, 40))
    expect(fixture.dispose).not.toHaveBeenCalled()
    fixture.agent.setStatus('idle')
    await vi.waitFor(() => { expect(fixture.dispose).toHaveBeenCalledOnce() })
  })

  it('keeps the Agent attached when release is disabled', async () => {
    const fixture = await composed({ releaseOnIdle: false })
    await new Promise(resolve => setTimeout(resolve, 40))
    expect(fixture.dispose).not.toHaveBeenCalled()
    expect(fixture.ctx.agents.get(fixture.sessionId)).toBeDefined()
  })

  it('runs an admitted command without racing the release it postpones', async () => {
    const fixture = await composed({ releaseIdleDelayMs: 30 })
    const renamed = await fixture.remote.rename({ sessionId: fixture.sessionId, title: 'held open' })
    expect(renamed.ok).toBe(true)
    await vi.waitFor(() => { expect(fixture.dispose).toHaveBeenCalledOnce() })
  })
})
