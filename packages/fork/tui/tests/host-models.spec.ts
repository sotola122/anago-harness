import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { listModelOptions, resolveModelRoute } from '../src/host/models.ts'

/** One advertised model in the fake catalog. */
interface FakeModel {
  readonly id: string
  readonly name: string
  readonly description?: string
}

/** One provider the fake LLM service advertises; no models means a missing catalog. */
interface FakeProvider {
  readonly id: string
  readonly models?: readonly FakeModel[]
}

/**
 * Provide a fake `llm` service over a fixed catalog.
 * @param ctx - context receiving the service.
 * @param providers - advertised providers and their catalogs.
 * @param resolve - how `resolveCallConfig` answers, defaulting to the input route.
 */
function provideLlm(ctx: Context, providers: readonly FakeProvider[], resolve?: (route: {
  readonly provider: string
  readonly model: string
}) => { provider: string; model: string }): void {
  ctx.provide('llm', {
    listProviders: () => providers.map(provider => ({ id: provider.id })),
    listModels: async (id: string) => {
      const provider = providers.find(candidate => candidate.id === id)
      if (provider?.models === undefined) throw new Error(`no model catalog for ${id}`)
      return provider.models
    },
    resolveCallConfig: async (route: { provider: string; model: string }) => resolve?.(route) ?? route,
  } as never)
}

/**
 * Provide the configured-default service.
 * @param ctx - context receiving the service.
 * @param selection - configured default route.
 */
function provideDefault(ctx: Context, selection: { provider: string; model: string }): void {
  ctx.provide('agentDefaultModel', { currentSelection: () => selection } as never)
}

describe('model catalog listing without the llm service', () => {
  it('offers the route the Agent currently uses', async () => {
    const ctx = new Context()

    const options = await listModelOptions(ctx, { provider: 'deepseek', model: 'deepseek-v4' })

    expect(options).toEqual([{
      provider: 'deepseek',
      model: 'deepseek-v4',
      label: 'deepseek-v4',
      current: true,
    }])
    await ctx.fiber.dispose()
  })

  it('falls back to the configured default route', async () => {
    const ctx = new Context()
    provideDefault(ctx, { provider: 'deepseek', model: 'deepseek-flash' })

    await expect(listModelOptions(ctx, undefined)).resolves.toEqual([{
      provider: 'deepseek',
      model: 'deepseek-flash',
      label: 'deepseek-flash',
      current: true,
    }])
    await ctx.fiber.dispose()
  })

  it('refuses the picker when nothing names a route', async () => {
    const ctx = new Context()

    await expect(listModelOptions(ctx, undefined))
      .rejects.toThrow(/requires the llm service or a configured agentDefaultModel/)
    await ctx.fiber.dispose()
  })
})

describe('model catalog listing through the llm service', () => {
  it('lists every provider catalog in provider order and marks the current route', async () => {
    const ctx = new Context()
    provideLlm(ctx, [
      {
        id: 'deepseek',
        models: [
          { id: 'deepseek-v4', name: 'DeepSeek V4', description: 'flagship' },
          { id: 'deepseek-flash', name: 'DeepSeek Flash' },
        ],
      },
      { id: 'local', models: [{ id: 'qwen', name: 'Qwen' }] },
    ])

    const options = await listModelOptions(ctx, { provider: 'deepseek', model: 'deepseek-flash' })

    expect(options).toEqual([
      { provider: 'deepseek', model: 'deepseek-v4', label: 'DeepSeek V4', description: 'flagship', current: false },
      { provider: 'deepseek', model: 'deepseek-flash', label: 'DeepSeek Flash', current: true },
      { provider: 'local', model: 'qwen', label: 'Qwen', current: false },
    ])
    await ctx.fiber.dispose()
  })

  it('omits a provider whose adapter publishes no catalog', async () => {
    const ctx = new Context()
    provideLlm(ctx, [
      { id: 'deepseek', models: [{ id: 'deepseek-v4', name: 'DeepSeek V4' }] },
      { id: 'local' },
    ])

    const options = await listModelOptions(ctx, undefined)

    expect(options.map(option => option.provider)).toEqual(['deepseek'])
    await ctx.fiber.dispose()
  })

  it('prepends the current route when no catalog advertises it', async () => {
    const ctx = new Context()
    provideLlm(ctx, [{ id: 'deepseek', models: [{ id: 'deepseek-v4', name: 'DeepSeek V4' }] }])

    const options = await listModelOptions(ctx, { provider: 'deepseek-account', model: 'deepseek-pro' })

    expect(options).toEqual([
      { provider: 'deepseek-account', model: 'deepseek-pro', label: 'deepseek-pro', current: true },
      { provider: 'deepseek', model: 'deepseek-v4', label: 'DeepSeek V4', current: false },
    ])
    await ctx.fiber.dispose()
  })

  it('does not mark a route whose provider matches but whose model differs', async () => {
    const ctx = new Context()
    provideLlm(ctx, [{
      id: 'deepseek',
      models: [{ id: 'deepseek-v4', name: 'DeepSeek V4' }, { id: 'deepseek-flash', name: 'DeepSeek Flash' }],
    }])

    const options = await listModelOptions(ctx, { provider: 'deepseek', model: 'unknown' })

    expect(options.filter(option => option.current)).toEqual([
      { provider: 'deepseek', model: 'unknown', label: 'unknown', current: true },
    ])
    await ctx.fiber.dispose()
  })
})

describe('model route resolution', () => {
  it('passes the chosen route through when no adapters exist', async () => {
    const ctx = new Context()

    await expect(resolveModelRoute(ctx, { provider: 'deepseek', model: 'deepseek-v4' }))
      .resolves.toEqual({ provider: 'deepseek', model: 'deepseek-v4' })
    await ctx.fiber.dispose()
  })

  it('normalizes the route through the adapter that owns it', async () => {
    const ctx = new Context()
    provideLlm(ctx, [], route => ({ provider: `${route.provider}-account`, model: `${route.model}-latest` }))

    await expect(resolveModelRoute(ctx, { provider: 'deepseek', model: 'deepseek-v4' }))
      .resolves.toEqual({ provider: 'deepseek-account', model: 'deepseek-v4-latest' })
    await ctx.fiber.dispose()
  })
})
