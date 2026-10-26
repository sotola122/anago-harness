import { describe, expect, it, vi } from 'vitest'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { AgentOptions } from '@deepseek-ai/dsh-agent'
import { MockAdapter } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { resolveChildRoutes } from '../src/model-selection.ts'
import {
  assertPurposeRouteTable,
  PURPOSE_CATEGORIES,
  PURPOSE_CATEGORY_DESCRIPTION,
  PURPOSE_TOOL_SENTENCE,
  resolvePurposeRoutes,
} from '../src/purpose-routing.ts'
import type { PurposeRoute, PurposeRouteTable } from '../src/purpose-routing.ts'
import { callSubagent, modelSelectionSetupAgent, setup, text } from './harness.ts'

const EFFORT = {
  low: ReasoningEffortId('low'),
  medium: ReasoningEffortId('medium'),
  high: ReasoningEffortId('high'),
  xhigh: ReasoningEffortId('xhigh'),
} as const

function route(provider: string, model: string, reasoningEffort: PurposeRoute['reasoningEffort']): PurposeRoute {
  return { provider, model, reasoningEffort }
}

function table(review: readonly PurposeRoute[] = [route('reviewer', 'one', EFFORT.high)]): PurposeRouteTable {
  return {
    light: [route('alpha', 'light-model', EFFORT.low)],
    medium: [route('alpha', 'medium-model', EFFORT.medium)],
    deep: [route('alpha', 'deep-model', EFFORT.high)],
    review,
    writing: [route('beta', 'writer', EFFORT.medium)],
    default: [route('gamma', 'general', EFFORT.high)],
  }
}

const parentOptions: AgentOptions = { provider: 'parent', model: 'parent-model', reasoningEffort: EFFORT.xhigh }

describe('purpose route resolution', () => {
  it('resolves each named category and treats omission as default', () => {
    const routes = table([
      route('reviewer', 'one', EFFORT.high),
      route('reviewer', 'two', EFFORT.xhigh),
    ])
    for (const category of PURPOSE_CATEGORIES) {
      if (category === 'review') continue
      const resolved = resolveChildRoutes({
        purposeRouting: true,
        category,
        modelRequest: {},
        table: routes,
        parentOptions,
        configured: { maxTokens: 128 },
        providerRouteDefaults: undefined,
        modelSelectionEnabled: false,
      })
      expect(resolved.source).toEqual({ kind: 'purpose', slot: category })
      expect(resolved.enforceAllowlist).toBe(false)
      expect(resolved.children).toEqual([{
        route: routes[category][0],
        options: { maxTokens: 128, ...routes[category][0] },
      }])
    }
    const omitted = resolveChildRoutes({
      purposeRouting: true,
      modelRequest: {},
      table: routes,
      parentOptions,
      configured: undefined,
      providerRouteDefaults: { provider: 'defaults', model: 'defaults-model' },
      modelSelectionEnabled: false,
    })
    expect(omitted.source).toEqual({ kind: 'purpose', slot: 'default' })
    expect(omitted.children[0]?.options).toEqual({
      provider: 'gamma',
      model: 'general',
      reasoningEffort: EFFORT.high,
    })
    expect(resolvePurposeRoutes(routes, 'review')).toEqual(routes.review)
    expect(resolveChildRoutes({
      purposeRouting: true,
      category: 'review',
      modelRequest: {},
      table: routes,
      parentOptions,
      configured: undefined,
      providerRouteDefaults: undefined,
      modelSelectionEnabled: true,
    }).children.map(child => child.route)).toEqual(routes.review)
  })

  it('rejects a combined route argument, an unknown category, and a missing table', () => {
    expect(() => resolveChildRoutes({
      purposeRouting: false,
      category: 'light',
      modelRequest: {},
      table: null,
      parentOptions,
      configured: undefined,
      providerRouteDefaults: undefined,
      modelSelectionEnabled: false,
    })).toThrow('category selection is not available for this tool')
    expect(() => resolveChildRoutes({
      purposeRouting: true,
      category: 'deep',
      modelRequest: { provider: 'alpha', model: 'deep-model' },
      table: table(),
      parentOptions,
      configured: undefined,
      providerRouteDefaults: undefined,
      modelSelectionEnabled: true,
    })).toThrow('`category` cannot be combined with `provider`, `model`, or `reasoning_effort`')
    expect(() => resolveChildRoutes({
      purposeRouting: true,
      category: 'default',
      modelRequest: {},
      table: table(),
      parentOptions,
      configured: undefined,
      providerRouteDefaults: undefined,
      modelSelectionEnabled: false,
    })).toThrow('unknown category "default"; use light, medium, deep, review, or writing, or omit it')
    expect(() => resolveChildRoutes({
      purposeRouting: true,
      modelRequest: {},
      table: undefined,
      parentOptions,
      configured: undefined,
      providerRouteDefaults: undefined,
      modelSelectionEnabled: false,
    })).toThrow('no child model is configured for this tool; report that to the user')
    expect(() => resolveChildRoutes({
      purposeRouting: true,
      modelRequest: { provider: 'alpha', model: 'fast-model' },
      table: null,
      parentOptions,
      configured: undefined,
      providerRouteDefaults: undefined,
      modelSelectionEnabled: true,
    })).toThrow('no child model is configured for this tool; report that to the user')
  })

  it('subjects an explicit selection to the allowlist and skips it for a category', () => {
    const explicit = resolveChildRoutes({
      purposeRouting: true,
      modelRequest: { reasoning_effort: 'low' },
      table: table(),
      parentOptions,
      configured: { maxTokens: 32 },
      providerRouteDefaults: undefined,
      modelSelectionEnabled: true,
    })
    expect(explicit.enforceAllowlist).toBe(true)
    expect(explicit.source).toEqual({ kind: 'explicit' })
    expect(explicit.children[0]?.options).toEqual({
      maxTokens: 32,
      provider: 'gamma',
      model: 'general',
      reasoningEffort: EFFORT.low,
    })
    const labeled = resolveChildRoutes({
      purposeRouting: true,
      category: 'writing',
      modelRequest: {},
      table: table(),
      parentOptions,
      configured: undefined,
      providerRouteDefaults: undefined,
      modelSelectionEnabled: true,
    })
    expect(labeled.enforceAllowlist).toBe(false)
  })

  it('rejects an empty list, a second non-review route, and a duplicate triple', () => {
    const empty = table()
    const emptied = { ...empty, light: [] }
    expect(() => { assertPurposeRouteTable(emptied) }).toThrow('light" requires at least one route')
    expect(() => {
      assertPurposeRouteTable(table([route('reviewer', 'one', EFFORT.high), route('reviewer', 'one', EFFORT.high)]))
    }).toThrow('repeats route')
    const extra = {
      ...table(),
      writing: [route('beta', 'writer', EFFORT.medium), route('beta', 'other', EFFORT.low)],
    }
    expect(() => { assertPurposeRouteTable(extra) }).toThrow('writing" accepts exactly one route')
  })
})

const REASONING = {
  efforts: [EFFORT.low, EFFORT.medium, EFFORT.high, EFFORT.xhigh].map(id => ({ id, name: id })),
  defaultEffort: EFFORT.high,
} as const

function registerRoutes(ctx: Awaited<ReturnType<typeof setup>>): void {
  for (const provider of ['alpha', 'beta', 'gamma', 'reviewer']) {
    ctx.llm.registerAdapter([provider], new MockAdapter([], REASONING))
  }
}

describe('purpose routing execution', () => {
  it('fails load without a settings service, a table, a route field, or providerOwnedRoute', async () => {
    await expect(setup({ provider: 'mock', purposeRouting: true })).rejects.toThrow('purposeRouting requires')
    await expect(setup({ provider: 'mock', purposeRouting: true, purposeRoutes: null })).rejects.toThrow('purposeRoutes table')
    await expect(setup({
      provider: 'mock',
      purposeRouting: true,
      providerOwnedRoute: true,
    })).rejects.toThrow('providerOwnedRoute')
    await expect(setup({
      provider: 'mock',
      purposeRouting: true,
      agentOptions: { provider: 'alpha' },
    })).rejects.toThrow('agentOptions')
  })

  it('keeps the tool definition unchanged unless purpose routing is enabled', async () => {
    const plain = await setup({ provider: 'mock' })
    const enabled = await setup({ provider: 'mock', purposeRouting: true, purposeRoutes: table() })
    const plainSchema = plain.tools.schemas().find(entry => entry.name === 'subagent')!
    const enabledSchema = enabled.tools.schemas().find(entry => entry.name === 'subagent')!
    const plainProps = (plainSchema.parameters as { properties: Record<string, unknown> }).properties
    const enabledProps = (enabledSchema.parameters as { properties: Record<string, { description?: string; enum?: string[] }> }).properties
    expect(plainProps.category).toBeUndefined()
    expect(plainSchema.description).not.toContain('Choose `category`')
    expect(enabledProps.category?.enum).toEqual([...PURPOSE_CATEGORIES])
    expect(enabledProps.category?.description).toBe(PURPOSE_CATEGORY_DESCRIPTION)
    expect(enabledSchema.description).toContain(PURPOSE_TOOL_SENTENCE)
    expect(JSON.stringify(enabledSchema)).not.toContain('light-model')
  })

  it.each([
    ['light', 'light-model'],
    ['medium', 'medium-model'],
    ['deep', 'deep-model'],
    ['writing', 'writer'],
  ] as const)('starts one %s child from the live table', async (category, model) => {
    const requests: AgentOptions[] = []
    const ctx = await setup({ provider: 'mock', purposeRouting: true, purposeRoutes: table() }, {
      onStart: (request) => {
        if (request.agentOptions !== undefined) requests.push(request.agentOptions)
      },
    })
    registerRoutes(ctx)
    const result = await callSubagent(ctx, { description: 'purpose work', prompt: 'do it', category })
    expect(result.isError).toBe(false)
    expect(requests).toEqual([expect.objectContaining({ model })])
    expect(text(result)).toMatch(new RegExp(`^started subagent \\S+ · ${model} · `))
    expect(result.isError ? undefined : result.value).toMatchObject({
      kind: 'activation',
      provider: category === 'writing' ? 'beta' : 'alpha',
      model,
    })
    expect(result.isError ? undefined : result.value).not.toHaveProperty('subagentIds')
  })

  it('uses the default row when category is omitted and does not check allowedModels', async () => {
    const requests: AgentOptions[] = []
    const ctx = await setup({
      provider: 'mock',
      purposeRouting: true,
      purposeRoutes: table(),
      withModelSelection: true,
    }, {
      onStart: (request) => {
        if (request.agentOptions !== undefined) requests.push(request.agentOptions)
      },
    })
    registerRoutes(ctx)
    const result = await callSubagent(ctx, { description: 'general work', prompt: 'do it' })
    expect(result.isError).toBe(false)
    expect(requests[0]).toEqual(expect.objectContaining({ provider: 'gamma', model: 'general' }))
    const parent = modelSelectionSetupAgent(ctx)
    expect(parent.session.snapshotEvents().some(event => event.type === 'subagent/purpose-route')).toBe(true)
  })

  it('rejects an explicit route outside the allowlist and still starts that route from a category', async () => {
    const ctx = await setup({
      provider: 'mock',
      purposeRouting: true,
      purposeRoutes: table(),
      withModelSelection: true,
    })
    registerRoutes(ctx)
    const labeled = await callSubagent(ctx, { description: 'labeled', prompt: 'do it', category: 'light' })
    expect(labeled.isError).toBe(false)
    const named = await callSubagent(ctx, {
      description: 'named',
      prompt: 'do it',
      provider: 'alpha',
      model: 'light-model',
    })
    expect(named.isError).toBe(true)
    expect(text(named)).toContain('is not allowed for this Session')
  })

  it('hides provider and model names when preflight fails and keeps the cause on the event', async () => {
    const ctx = await setup({ provider: 'mock', purposeRouting: true, purposeRoutes: table() })
    const adapter = new MockAdapter([], REASONING)
    vi.spyOn(adapter, 'resolveModel').mockRejectedValue(new Error('alpha/deep-model preflight down'))
    ctx.llm.registerAdapter(['alpha'], adapter)
    const parent = modelSelectionSetupAgent(ctx)
    const result = await callSubagent(ctx, { description: 'deep work', prompt: 'do it', category: 'deep' }, { agent: parent })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('the model for category `deep` is unavailable; re-delegate once with the same `category`')
    expect(text(result)).not.toContain('alpha')
    expect(text(result)).not.toContain('deep-model')
    const recorded = parent.session.snapshotEvents().find(event => event.type === 'subagent/purpose-route')
    expect(recorded).toMatchObject({
      ignorable: true,
      data: {
        slot: 'deep',
        route: { provider: 'alpha', model: 'deep-model', reasoningEffort: 'high' },
        outcome: { kind: 'not-started', reason: 'alpha/deep-model preflight down' },
      },
    })
  })

  it('fans out review in table order and reports a partial start failure', async () => {
    const routes = table([
      route('alpha', 'first', EFFORT.high),
      route('alpha', 'second', EFFORT.high),
      route('alpha', 'third', EFFORT.xhigh),
    ])
    const started: string[] = []
    const ctx = await setup({ provider: 'mock', purposeRouting: true, purposeRoutes: routes }, {
      onStart: (request) => { started.push(request.agentOptions?.model ?? '') },
    })
    registerRoutes(ctx)
    const parent = modelSelectionSetupAgent(ctx)
    const original = ctx.subagents.startActivation.bind(ctx.subagents)
    let calls = 0
    vi.spyOn(ctx.subagents, 'startActivation').mockImplementation(async (spec) => {
      calls += 1
      if (spec.request.agentOptions?.model === 'second') throw new Error('second reviewer refused')
      return original(spec)
    })
    const result = await callSubagent(ctx, { description: 'review work', prompt: 'review it', category: 'review' }, { agent: parent })
    expect(calls).toBe(3)
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected a partial review start')
    const value = result.value
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('expected an activation object')
    }
    expect(value.subagentIds).toHaveLength(2)
    expect(value.subagentId).toBe(Array.isArray(value.subagentIds) ? value.subagentIds[0] : undefined)
    expect(value.notStarted).toBe(1)
    expect(value).toMatchObject({
      provider: 'alpha',
      model: 'first',
      reasoningEffort: 'high',
    })
    const children = Array.isArray(value.children) ? value.children : []
    expect(children.map(child => child !== null && typeof child === 'object' && 'model' in child ? child.model : undefined)).toEqual(['first', 'second', 'third'])
    expect(children[0]).toMatchObject({ subagentId: value.subagentId, provider: 'alpha', reasoningEffort: 'high' })
    expect(children[1]).toEqual({ provider: 'alpha', model: 'second', reasoningEffort: 'high' })
    expect(children[2]).toMatchObject({ provider: 'alpha', model: 'third', reasoningEffort: 'xhigh' })
    expect(children[2]).toHaveProperty('subagentId')
    expect(text(result)).toContain('started 2 subagents:')
    expect(text(result)).toContain('1 reviewer could not start')
    expect(text(result)).toContain('· first · high')
    expect(text(result)).toContain('· third · xhigh')
    expect(text(result)).not.toContain('second')
    expect(started).toEqual(['first', 'third'])
    const events = parent.session.snapshotEvents().filter(event => event.type === 'subagent/purpose-route')
    expect(events.map(event => event.data.route.model)).toEqual(['first', 'second', 'third'])
    expect(events.map(event => event.data.outcome.kind)).toEqual(['started', 'not-started', 'started'])
  })

  it('returns an error when no reviewer starts', async () => {
    const routes = table([
      route('alpha', 'first', EFFORT.high),
      route('alpha', 'second', EFFORT.high),
    ])
    const ctx = await setup({ provider: 'mock', purposeRouting: true, purposeRoutes: routes })
    registerRoutes(ctx)
    vi.spyOn(ctx.subagents, 'startActivation').mockRejectedValue(new Error('reviewer down'))
    const none = await callSubagent(ctx, { description: 'review work', prompt: 'review it', category: 'review' })
    expect(none.isError).toBe(true)
    expect(text(none)).toContain('the model for category `review` is unavailable')
  })

  it('stops children already started when the start loop aborts', async () => {
    const routes = table([
      route('alpha', 'first', EFFORT.high),
      route('alpha', 'second', EFFORT.high),
    ])
    const ctx = await setup({ provider: 'mock', purposeRouting: true, purposeRoutes: routes })
    registerRoutes(ctx)
    const parent = modelSelectionSetupAgent(ctx)
    const original = ctx.subagents.startActivation.bind(ctx.subagents)
    const controller = new AbortController()
    const interrupt = vi.spyOn(ctx.subagents, 'interrupt')
    vi.spyOn(ctx.subagents, 'startActivation').mockImplementation(async (spec) => {
      const started = await original(spec)
      if (spec.request.agentOptions?.model === 'first') controller.abort()
      return started
    })
    const aborted = await callSubagent(
      ctx,
      { description: 'review work', prompt: 'review it', category: 'review' },
      { agent: parent, signal: controller.signal },
    )
    expect(aborted.isError).toBe(true)
    expect(interrupt).toHaveBeenCalled()
  })
})
