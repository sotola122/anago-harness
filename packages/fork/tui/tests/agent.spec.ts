import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { openAgentSession } from '../src/host/agent.ts'

/** The Agent-option fields these tests inspect. */
interface AgentOptions {
  readonly provider?: string
  readonly model?: string
}

/** Agent creation or resume arguments captured by the fake service. */
interface OpenCall {
  readonly agentOptions?: AgentOptions
  readonly resumeSessionId?: SessionId
}

/** Fake `ctx.agents` plus the calls it recorded. */
interface FakeAgents {
  readonly created: OpenCall[]
  readonly resumed: OpenCall[]
}

/** One test's context and recorded Agent calls. */
interface Harness extends FakeAgents {
  readonly ctx: Context
}

const contexts: Context[] = []

/**
 * Provide a fake Agent service and, when `selection` is given, the default-model
 * service.
 * @param selection - configured default provider/model, or undefined for none.
 * @returns the context and the calls the fake service records.
 */
function harness(selection?: { provider: string; model: string }): Harness {
  const ctx = new Context()
  const created: OpenCall[] = []
  const resumed: OpenCall[] = []
  const handle = {
    agent: { id: 'agent-1', session: { id: SessionId('session-1') } },
    dispose: async () => {},
  }
  ctx.provide('agents', {
    create: async (call: OpenCall) => {
      created.push(call)
      return handle
    },
    resume: async (call: OpenCall) => {
      resumed.push(call)
      return handle
    },
  } as never)
  if (selection !== undefined) {
    ctx.provide('agentDefaultModel', { currentSelection: () => selection } as never)
  }
  contexts.push(ctx)
  return { ctx, created, resumed }
}

describe('openAgentSession model resolution', () => {
  afterEach(async () => {
    for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  })

  it('starts from the configured default when the invocation names no route', async () => {
    const fake = harness({ provider: 'deepseek', model: 'deepseek-flash' })

    await openAgentSession(fake.ctx, {})

    expect(fake.created).toHaveLength(1)
    expect(fake.created[0]?.agentOptions).toEqual({ provider: 'deepseek', model: 'deepseek-flash' })
  })

  it('starts from the invocation route when no default service is mounted', async () => {
    const fake = harness()

    await openAgentSession(fake.ctx, { provider: 'deepseek-account', model: 'deepseek-pro' })

    expect(fake.created[0]?.agentOptions).toEqual({ provider: 'deepseek-account', model: 'deepseek-pro' })
  })

  it('lets both overrides replace both default halves', async () => {
    const fake = harness({ provider: 'deepseek', model: 'deepseek-flash' })

    await openAgentSession(fake.ctx, { provider: 'deepseek-account', model: 'deepseek-pro' })

    expect(fake.created[0]?.agentOptions).toEqual({ provider: 'deepseek-account', model: 'deepseek-pro' })
  })

  it('keeps the default provider when only the model is overridden on resume', async () => {
    const fake = harness({ provider: 'deepseek', model: 'deepseek-flash' })

    await openAgentSession(fake.ctx, { resume: 'session-1', model: 'deepseek-pro' })

    expect(fake.created).toHaveLength(0)
    expect(fake.resumed).toHaveLength(1)
    expect(fake.resumed[0]?.resumeSessionId).toBe(SessionId('session-1'))
    expect(fake.resumed[0]?.agentOptions).toEqual({ provider: 'deepseek', model: 'deepseek-pro' })
  })

  it('keeps the default model when only the provider is overridden', async () => {
    const fake = harness({ provider: 'deepseek', model: 'deepseek-flash' })

    await openAgentSession(fake.ctx, { provider: 'deepseek-account' })

    expect(fake.created[0]?.agentOptions).toEqual({ provider: 'deepseek-account', model: 'deepseek-flash' })
  })

  it('refuses to dispatch when neither a default nor an override names a route', async () => {
    const fake = harness()

    await expect(openAgentSession(fake.ctx, {})).rejects.toThrow(/no provider\/model configured/)
    await expect(openAgentSession(fake.ctx, {})).rejects.toThrow(/agentDefaultModel\.provider/)
    expect(fake.created).toHaveLength(0)
    expect(fake.resumed).toHaveLength(0)
  })
})
