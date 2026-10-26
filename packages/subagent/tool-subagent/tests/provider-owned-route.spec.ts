/** Per-call routes for providers that interpret their own route namespace. */
import { describe, expect, it } from 'vitest'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { callSubagent, setup, text } from './harness.ts'

describe('providerOwnedRoute', () => {
  it('exposes the route arguments without the Host model-selection service', async () => {
    const ctx = await setup({ provider: 'mock', providerOwnedRoute: true })
    const agent = (await ctx.agents.create({ sessionId: SessionId('route-schema-agent') })).agent
    const schema = ctx.tools.schemas(agent).find(candidate => candidate.name === 'subagent')
    const properties = (schema?.parameters as { properties?: Record<string, unknown> } | undefined)?.properties
    expect(properties?.['provider']).toBeDefined()
    expect(properties?.['model']).toBeDefined()
    expect(properties?.['reasoning_effort']).toBeDefined()
  })

  it('passes the call route to the provider as agentOptions', async () => {
    let seen: SubagentStartRequest | undefined
    const ctx = await setup(
      { provider: 'mock', providerOwnedRoute: true },
      { onStart: (request) => { seen = request } },
    )
    const result = await callSubagent(ctx, {
      prompt: 'delegate',
      description: 'route test',
      provider: 'command-code',
      model: 'deepseek/deepseek-v4.1-flash',
      reasoning_effort: 'high',
    })
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('started subagent')
    expect(seen?.agentOptions).toEqual({
      provider: 'command-code',
      model: 'deepseek/deepseek-v4.1-flash',
      reasoningEffort: ReasoningEffortId('high'),
    })
  })

  it('accepts a model without a provider', async () => {
    let seen: SubagentStartRequest | undefined
    const ctx = await setup(
      { provider: 'mock', providerOwnedRoute: true },
      { onStart: (request) => { seen = request } },
    )
    await callSubagent(ctx, { prompt: 'delegate', description: 'model only', model: 'fast-model' })
    expect(seen?.agentOptions).toEqual({ model: 'fast-model' })
  })

  it('accepts a provider without a model', async () => {
    let seen: SubagentStartRequest | undefined
    const ctx = await setup(
      { provider: 'mock', providerOwnedRoute: true },
      { onStart: (request) => { seen = request } },
    )
    await callSubagent(ctx, { prompt: 'delegate', description: 'provider only', provider: 'alpha' })
    expect(seen?.agentOptions).toEqual({ provider: 'alpha' })
  })

  it('accepts a reasoning effort alone', async () => {
    let seen: SubagentStartRequest | undefined
    const ctx = await setup(
      { provider: 'mock', providerOwnedRoute: true },
      { onStart: (request) => { seen = request } },
    )
    await callSubagent(ctx, { prompt: 'delegate', description: 'effort only', reasoning_effort: 'low' })
    expect(seen?.agentOptions).toEqual({ reasoningEffort: ReasoningEffortId('low') })
  })

  it('rejects an empty route value at the tool boundary', async () => {
    const ctx = await setup({ provider: 'mock', providerOwnedRoute: true })
    const result = await callSubagent(ctx, { prompt: 'delegate', description: 'empty model', model: '' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('must be non-empty')
  })

  it('passes no agentOptions when the call names no route', async () => {
    let seen: SubagentStartRequest | undefined
    const ctx = await setup(
      { provider: 'mock', providerOwnedRoute: true },
      { onStart: (request) => { seen = request } },
    )
    await callSubagent(ctx, { prompt: 'delegate', description: 'no route' })
    expect(seen?.agentOptions).toBeUndefined()
  })

  it('rejects a provider that does not accept per-call agent options', async () => {
    await expect(setup(
      { provider: 'mock', providerOwnedRoute: true },
      { capabilities: { agentOptions: false } },
    )).rejects.toThrow(/does not accept per-call agent options/)
  })
})
