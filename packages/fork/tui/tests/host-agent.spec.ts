import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { abortAgent, openAgentSession, sendPrompt } from '../src/host/agent.ts'

/** A handle the fake Agent service can return. */
const HANDLE = {
  agent: { id: 'agent-1', session: { id: SessionId('session-1') } },
  dispose: async () => {},
}

/** The route these tests resolve. */
const ROUTE = { provider: 'deepseek', model: 'deepseek-flash' }

/**
 * Provide a fake Agent service whose creation fails a fixed number of times
 * before succeeding.
 * @param failures - errors thrown by the first attempts, in order.
 * @returns the context and the attempt counter.
 */
function harness(failures: readonly unknown[]): { ctx: Context; attempts: () => number } {
  const ctx = new Context()
  let attempts = 0
  ctx.provide('agents', {
    create: async () => {
      attempts += 1
      const failure = failures[attempts - 1]
      if (failure !== undefined) throw failure
      return HANDLE
    },
    resume: async () => {
      attempts += 1
      const failure = failures[attempts - 1]
      if (failure !== undefined) throw failure
      return HANDLE
    },
  } as never)
  return { ctx, attempts: () => attempts }
}

const contexts: Context[] = []

describe('Agent factory retry', () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  })

  it('waits for a late agent-loop factory before opening the Session', async () => {
    const fake = harness([new Error('no agent factory registered yet')])
    contexts.push(fake.ctx)

    const opened = await openAgentSession(fake.ctx, { provider: ROUTE.provider, model: ROUTE.model })

    expect(opened.route).toEqual(ROUTE)
    expect(fake.attempts()).toBe(2)
  })

  it('retries the same way when the rejection is not an Error instance', async () => {
    const fake = harness(['no agent factory registered yet'])
    contexts.push(fake.ctx)

    await expect(openAgentSession(fake.ctx, { provider: ROUTE.provider, model: ROUTE.model }))
      .resolves.toMatchObject({ route: ROUTE })
    expect(fake.attempts()).toBe(2)
  })

  it('surfaces an unrelated creation failure without retrying', async () => {
    const fake = harness([new Error('the provider rejected the request')])
    contexts.push(fake.ctx)

    await expect(openAgentSession(fake.ctx, { provider: ROUTE.provider, model: ROUTE.model }))
      .rejects.toThrow('the provider rejected the request')
    expect(fake.attempts()).toBe(1)
  })

  it('gives up once the factory wait window closes', async () => {
    const fake = harness([
      new Error('no agent factory registered'),
      new Error('no agent factory registered'),
      new Error('no agent factory registered'),
    ])
    contexts.push(fake.ctx)
    let clock = 0
    vi.spyOn(Date, 'now').mockImplementation(() => {
      clock += 3_000
      return clock
    })

    await expect(openAgentSession(fake.ctx, { provider: ROUTE.provider, model: ROUTE.model }))
      .rejects.toThrow('no agent factory registered')
    expect(fake.attempts()).toBe(1)
  })
})

describe('prompt delivery', () => {
  it('follows up while the Agent is idle', () => {
    const followup = vi.fn()
    const steer = vi.fn()
    const agent = { status: 'idle', followup, steer }

    sendPrompt(agent as never, 'run the tests')

    expect(followup).toHaveBeenCalledTimes(1)
    expect(steer).not.toHaveBeenCalled()
    expect(followup.mock.calls[0]?.[0]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'run the tests' }],
      source: { kind: 'user' },
    })
  })

  it('steers while a turn is already running', () => {
    const followup = vi.fn()
    const steer = vi.fn()
    const agent = { status: 'running', followup, steer }

    sendPrompt(agent as never, 'also check the docs')

    expect(steer).toHaveBeenCalledTimes(1)
    expect(followup).not.toHaveBeenCalled()
  })

  it('aborts the running turn without discarding queued input', () => {
    const cancel = vi.fn()

    abortAgent({ cancel } as never)

    expect(cancel).toHaveBeenCalledWith({ kind: 'user' }, { keepInbox: true })
  })
})
