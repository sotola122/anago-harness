import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'

const KEY = 'llm-pi-ai/github-copilot'

/** One OAuth grant carrying the account's usable Copilot model ids. */
const GRANT = {
  kind: 'grant',
  payload: {
    type: 'oauth',
    access: 'access-token',
    refresh: 'refresh-token',
    expires: Date.now() + 3_600_000,
    availableModelIds: ['gpt-5.6-sol', 'claude-sonnet-5.5'],
  },
}

/**
 * Compose the pi-ai adapter with a credentials service holding one record.
 * @param recordFor - record returned by `readRecord` for any key, or undefined for none.
 */
async function boot(recordFor: (key: string) => unknown): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  ctx.provide('credentials', {
    readRecord: async (key: unknown) => recordFor(String(key)),
    listRecords: async () => [],
    describeRecord: async () => ({ configured: recordFor(KEY) !== undefined, writable: true }),
    resolve: async () => undefined,
    modifyRecord: async () => undefined,
    deleteRecord: async () => {},
  } as never)
  await ctx.plugin(LlmPiAi, { providers: { 'github-copilot': {}, openai: {} } })
  return ctx
}

describe('subscription model filter', () => {
  it('narrows the route to the stored grant available models', async () => {
    const ctx = await boot(key => key === KEY ? GRANT : undefined)
    const models = await ctx.llm.listModels('github-copilot')
    expect(models.map(model => model.id).sort()).toEqual(['claude-sonnet-5.5', 'gpt-5.6-sol'])
    await ctx.fiber.dispose()
  })

  it('keeps the catalog for a route with no stored credential', async () => {
    const ctx = await boot(() => undefined)
    const models = await ctx.llm.listModels('github-copilot')
    expect(models.length).toBeGreaterThan(2)
    await ctx.fiber.dispose()
  })

  it('keeps the catalog for an authenticated route without a model filter', async () => {
    const ctx = await boot(() => GRANT)
    const models = await ctx.llm.listModels('openai')
    expect(models.some(model => model.id === 'gpt-4.1')).toBe(true)
    await ctx.fiber.dispose()
  })
})
