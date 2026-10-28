import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import {
  PURPOSE_CATEGORIES,
  PURPOSE_CATEGORY_DESCRIPTION,
  PURPOSE_CATEGORY_PURPOSES,
} from '../src/purpose-routing.ts'
import type { PurposeRoute, PurposeRouteTable } from '../src/purpose-routing.ts'
import { registerListSubagentCategories } from '../src/list-categories.ts'
import * as tool from '../src/index.ts'
import { setup, testToolSignal, text } from './harness.ts'

const EFFORT = ReasoningEffortId('low')
const PINNED_CATEGORY_DESCRIPTION = 'Task purpose that selects the child model. `light`: quick lookups, small mechanical edits, short summaries. `medium`: ordinary implementation or investigation. `deep`: hard debugging, design, or long multi-step reasoning. `review`: independent review of a change, plan, or document; may start several reviewers in parallel, each reporting separately. `writing`: documentation, PR or issue text, translation, user-facing prose. Do not combine with `provider`, `model`, or `reasoning_effort`.'
const ROUTE_IDS = ['purpose-provider-alpha', 'purpose-provider-beta', 'purpose-model-light', 'purpose-model-review']

function route(provider: string, model: string): PurposeRoute {
  return { provider, model, reasoningEffort: EFFORT }
}

function table(): PurposeRouteTable {
  return {
    light: [route('purpose-provider-alpha', 'purpose-model-light')],
    medium: [route('purpose-provider-alpha', 'purpose-model-medium')],
    deep: [route('purpose-provider-alpha', 'purpose-model-deep')],
    review: [route('purpose-provider-beta', 'purpose-model-review')],
    writing: [route('purpose-provider-beta', 'purpose-model-writer')],
    default: [route('purpose-provider-gamma', 'purpose-model-general')],
  }
}

let counter = 0

function call(ctx: Context) {
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: ToolCallId(`list-categories-${++counter}`),
    name: 'list_subagent_categories',
    arguments: {},
  })
}

function assertNoRouteIdentifiers(encoded: string): void {
  for (const id of ROUTE_IDS) expect(encoded).not.toContain(id)
  expect(encoded).not.toContain('purpose-provider')
  expect(encoded).not.toContain('purpose-model')
  expect(encoded).not.toMatch(/"provider"|"model"|"reasoningEffort"|"reasoning_effort"/)
}

describe('list_subagent_categories', () => {
  it('keeps the category parameter description assembled from the shared purpose clauses', () => {
    expect(PURPOSE_CATEGORY_DESCRIPTION).toBe(PINNED_CATEGORY_DESCRIPTION)
    for (const id of PURPOSE_CATEGORIES) {
      expect(PURPOSE_CATEGORY_DESCRIPTION).toContain(PURPOSE_CATEGORY_PURPOSES[id])
    }
  })

  it('is absent when purpose routing is off, including a provider-owned route', async () => {
    const plain = await setup({ provider: 'mock' })
    const owned = await setup({ provider: 'mock', providerOwnedRoute: true })
    expect(plain.tools.get('list_subagent_categories')).toBeUndefined()
    expect(owned.tools.get('list_subagent_categories')).toBeUndefined()
    const schema = plain.tools.schemas().find(entry => entry.name === 'subagent')
    const properties = (schema?.parameters as { properties?: Record<string, unknown> }).properties
    expect(properties?.category).toBeUndefined()
    expect(schema?.description).not.toContain('Choose `category`')
  })

  it('returns the closed labels and no route identifiers when the table is populated', async () => {
    const ctx = await setup({ provider: 'mock', purposeRouting: true, purposeRoutes: table() })
    const definition = ctx.tools.get('list_subagent_categories')
    expect(definition?.description).toBe('List subagent category labels, the job each label is for, and whether omitting category currently selects a configured default. This tool does not list providers, models, or reasoning efforts. It does not choose a child. Pass a listed label as subagent category, or omit category for general work.')
    expect(definition?.parameters).toEqual({ type: 'object', properties: {} })
    expect(definition?.isConcurrencySafe?.({})).toBe(true)
    const output = JSON.stringify(definition?.output.schema)
    expect(output).toContain('"additionalProperties":false')
    for (const id of PURPOSE_CATEGORIES) expect(output).toContain(`"${id}"`)
    expect(output).not.toContain('"default"')
    expect(output).not.toContain('provider')
    expect(output).not.toContain('reasoningEffort')

    const delegation = ctx.tools.schemas().find(entry => entry.name === 'subagent')
    const category = (delegation?.parameters as { properties: Record<string, { description?: string }> }).properties.category
    expect(category?.description).toBe(PURPOSE_CATEGORY_DESCRIPTION)

    const result = await call(ctx)
    expect(result.isError).toBe(false)
    if (result.isError) return
    expect(result.value).toEqual({
      categories: PURPOSE_CATEGORIES.map(id => ({
        id,
        purpose: PURPOSE_CATEGORY_PURPOSES[id],
        fanOut: id === 'review',
      })),
      omission: {
        purpose: 'Omitting category selects the configured default for general work. The label default is not a category.',
        configured: true,
      },
    })
    const visible = text(result)
    expect(visible).toBe([
      'light — quick lookups, small mechanical edits, short summaries — one child',
      'medium — ordinary implementation or investigation — one child',
      'deep — hard debugging, design, or long multi-step reasoning — one child',
      'review — independent review of a change, plan, or document; may start several reviewers in parallel, each reporting separately — one child per configured route',
      'writing — documentation, PR or issue text, translation, user-facing prose — one child',
      'Omitting category selects the configured default for general work: yes',
    ].join('\n'))
    assertNoRouteIdentifiers(JSON.stringify(result.value))
    assertNoRouteIdentifiers(visible)
    expect(result.meta).toBeUndefined()
  })

  it('reports an unresolved default when the live table is null and keeps the schema fixed', async () => {
    const ctx = await setup({ provider: 'mock', purposeRouting: true, purposeRoutes: table() })
    const before = JSON.stringify(ctx.tools.schemas().find(entry => entry.name === 'list_subagent_categories'))
    const settings = ctx.get('subagentModelSelection')
    if (settings === undefined) throw new Error('settings service missing')
    vi.spyOn(settings, 'purposeRoutes').mockReturnValue(null)
    const result = await call(ctx)
    expect(result.isError).toBe(false)
    if (result.isError) return
    expect(result.value).toMatchObject({ omission: { configured: false } })
    expect((result.value as { categories: unknown[] }).categories).toHaveLength(5)
    expect(text(result)).toMatch(/: no$/)
    assertNoRouteIdentifiers(JSON.stringify(result.value))
    assertNoRouteIdentifiers(text(result))
    expect(JSON.stringify(ctx.tools.schemas().find(entry => entry.name === 'list_subagent_categories'))).toBe(before)
  })

  it('reports an unresolved default when the default row is empty', async () => {
    const ctx = await setup({ provider: 'mock', purposeRouting: true, purposeRoutes: table() })
    const settings = ctx.get('subagentModelSelection')
    if (settings === undefined) throw new Error('settings service missing')
    vi.spyOn(settings, 'purposeRoutes').mockReturnValue({ ...table(), default: [] })
    const result = await call(ctx)
    expect(result.isError).toBe(false)
    if (result.isError) return
    expect(result.value).toMatchObject({ omission: { configured: false } })
    expect(text(result)).toMatch(/: no$/)
  })

  it('reports an unresolved default when the settings service is absent', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    registerListSubagentCategories(ctx)
    const result = await call(ctx)
    expect(result.isError).toBe(false)
    if (result.isError) return
    expect(result.value).toMatchObject({
      omission: { configured: false },
    })
    expect((result.value as { categories: unknown[] }).categories).toHaveLength(5)
    expect(text(result)).toMatch(/: no$/)
    await ctx.fiber.dispose()
  })

  it('replaces a table-read failure with the missing-table error and keeps route ids in the log only', async () => {
    const ctx = await setup({ provider: 'mock', purposeRouting: true, purposeRoutes: table() })
    const settings = ctx.get('subagentModelSelection')
    if (settings === undefined) throw new Error('settings service missing')
    const leaked = 'purpose route slot "review" repeats route "purpose-provider-beta/purpose-model-review/low"'
    vi.spyOn(settings, 'purposeRoutes').mockImplementation(() => {
      throw new Error(leaked)
    })
    const warn = vi.spyOn(ctx.logger, 'warn')
    const result = await call(ctx)
    expect(result.isError).toBe(true)
    expect(text(result)).toBe('Error: no child model is configured for this tool; report that to the user')
    expect(text(result)).not.toContain('purpose-provider-beta')
    expect(text(result)).not.toContain('purpose-model-review')
    expect(warn).toHaveBeenCalled()
    expect(String(warn.mock.calls)).toContain('purpose-model-review')
  })

  it('rejects a second registration in the same tool scope', async () => {
    const ctx = await setup({ provider: 'mock', purposeRouting: true, purposeRoutes: table() })
    await expect(ctx.plugin(tool, {
      provider: 'mock',
      purposeRouting: true,
      toolName: 'subagent_other',
    })).rejects.toThrow('already registered')
  })

  it('removes the tool when the registering fiber is disposed', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const fiber = ctx.inject(['tools'], (inner) => {
      registerListSubagentCategories(inner)
    })
    await fiber
    expect(ctx.tools.get('list_subagent_categories')).toBeDefined()
    await fiber.dispose()
    expect(ctx.tools.get('list_subagent_categories')).toBeUndefined()
    await ctx.fiber.dispose()
  })
})
