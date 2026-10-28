import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import {
  assertPurposeGuidance,
  categoryDescriptionFor,
  composeCategoryDescription,
  PURPOSE_CATEGORY_DESCRIPTION,
  PURPOSE_CATEGORY_PURPOSES,
  PURPOSE_SENTENCE_MAX,
  PURPOSE_SPLITTING_MAX,
  PURPOSE_SPLITTING_PARAGRAPH,
} from '../src/purpose-routing.ts'
import type { PurposeGuidance, PurposeRoute, PurposeRouteTable } from '../src/purpose-routing.ts'
import SubagentModelSelectionConfig from '../src/model-selection-settings.ts'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { ownContext, setup, testToolSignal, text } from './harness.ts'

const EFFORT = ReasoningEffortId('low')
const PINNED = 'Task purpose that selects the child model. `light`: quick lookups, small mechanical edits, short summaries. `medium`: ordinary implementation or investigation. `deep`: hard debugging, design, or long multi-step reasoning. `review`: independent review of a change, plan, or document; may start several reviewers in parallel, each reporting separately. `writing`: documentation, PR or issue text, translation, user-facing prose. Do not combine with `provider`, `model`, or `reasoning_effort`.'

function route(provider: string, model: string): PurposeRoute {
  return { provider, model, reasoningEffort: EFFORT }
}

function table(): PurposeRouteTable {
  return {
    light: [route('route-alpha', 'model-light')],
    medium: [route('route-alpha', 'model-medium')],
    deep: [route('route-alpha', 'model-deep')],
    review: [route('route-review', 'model-review')],
    writing: [route('route-beta', 'model-writer')],
    default: [route('route-gamma', 'model-general')],
  }
}

function guidance(overrides: Partial<PurposeGuidance> = {}): PurposeGuidance {
  return {
    light: 'A short lookup.',
    medium: 'An ordinary change whose approach is known.',
    deep: 'An unexplained bug.',
    review: 'An independent review of an existing change.',
    writing: 'Documentation as the deliverable.',
    omit: 'Only when the task fits no named purpose.',
    splitting: '',
    ...overrides,
  }
}

async function listCategories(ctx: Context, callId: string) {
  const batch = await ctx.tools.execute({
    signal: testToolSignal,
    calls: [{
      type: 'tool-call',
      id: ToolCallId(callId),
      name: 'list_subagent_categories',
      arguments: '{}',
    }],
  })
  const result = batch.results[0]?.result
  if (result === undefined) throw new Error('list_subagent_categories returned no result')
  return result
}

function categoryDescription(ctx: Context): string | undefined {
  const schema = ctx.tools.schemas().find(entry => entry.name === 'subagent')
  const properties = (schema?.parameters as { properties?: Record<string, { description?: string }> }).properties
  return properties?.category?.description
}

describe('purpose guidance composition', () => {
  it('keeps the pinned category description byte-identical when guidance is null', () => {
    expect(PURPOSE_CATEGORY_DESCRIPTION).toBe(PINNED)
    expect(categoryDescriptionFor(null)).toBe(PURPOSE_CATEGORY_DESCRIPTION)
    expect(composeCategoryDescription(null, table())).toBe(PURPOSE_CATEGORY_DESCRIPTION)
  })

  it('composes a populated guidance value and rejects a missing or over-long sentence', () => {
    const value = guidance({ splitting: 'Keep related edits in one call.' })
    const description = composeCategoryDescription(value, table())
    expect(description).toBe(categoryDescriptionFor(value))
    expect(description).toContain('`light`: A short lookup.')
    expect(description).toContain('`review`: An independent review of an existing change. Starts one child per configured reviewer; each reports separately.')
    expect(description).toContain('Omit `category`: Only when the task fits no named purpose.')
    expect(description).not.toContain('model-light')
    expect(() => { assertPurposeGuidance(guidance({ omit: '' })) }).toThrow('slot "omit" requires a sentence')
    expect(() => { assertPurposeGuidance(guidance({ deep: 'x'.repeat(PURPOSE_SENTENCE_MAX + 1) })) })
      .toThrow(`slot "deep" exceeds ${PURPOSE_SENTENCE_MAX} characters`)
    expect(() => { assertPurposeGuidance(guidance({ splitting: 'y'.repeat(PURPOSE_SPLITTING_MAX + 1) })) })
      .toThrow(`slot "splitting" exceeds ${PURPOSE_SPLITTING_MAX} characters`)
    expect(() => { composeCategoryDescription(guidance({ writing: '' }), table()) }).toThrow('slot "writing" requires a sentence')
  })

  it('fails composition when a sentence contains a route identifier and names the slot', () => {
    expect(() => {
      composeCategoryDescription(guidance({ medium: 'Use route-alpha for this change.' }), table())
    }).toThrow('purpose guidance slot "medium" contains route identifier "route-alpha"')
    expect(() => {
      composeCategoryDescription(guidance({ splitting: 'Prefer model-writer for prose.' }), table())
    }).toThrow('purpose guidance slot "splitting" contains route identifier "model-writer"')
    expect(composeCategoryDescription(guidance({ light: 'alphabetical order' }), null)).toContain('alphabetical order')
  })
})

describe('purpose guidance settings', () => {
  it('rejects an over-long sentence and a missing sentence at load', async () => {
    const over = ownContext(new Context())
    await mountAgentLoopTestDependencies(over)
    await expect(over.plugin(SubagentModelSelectionConfig, {
      purposeGuidance: guidance({ light: 'x'.repeat(PURPOSE_SENTENCE_MAX + 1) }),
    })).rejects.toThrow(/light|200/)
    const missing = ownContext(new Context())
    await mountAgentLoopTestDependencies(missing)
    await expect(missing.plugin(SubagentModelSelectionConfig, {
      purposeGuidance: { medium: 'known', deep: 'bug', review: 'review', writing: 'prose', omit: 'none', splitting: '' },
    })).rejects.toThrow(/light/)
  })

  it('uses the pinned description when guidance is null and does not publish a route id', async () => {
    const ctx = await setup({ provider: 'mock', purposeRouting: true, purposeRoutes: table() })
    expect(categoryDescription(ctx)).toBe(PURPOSE_CATEGORY_DESCRIPTION)
    expect(JSON.stringify(ctx.tools.schemas())).not.toContain('model-light')
    const assembly = await ctx.systemPrompt.assemble()
    const section = assembly.sections.find(item => item.text.startsWith('Start independent delegations'))
    expect(section?.text).toContain(PURPOSE_SPLITTING_PARAGRAPH)
    expect(section?.text.startsWith('Start independent delegations with `subagent`')).toBe(true)
    const listed = await listCategories(ctx, 'guidance-null')
    expect(listed.isError).toBe(false)
    if (listed.isError) return
    expect(listed.value).toMatchObject({
      categories: Object.entries(PURPOSE_CATEGORY_PURPOSES).map(([id, purpose]) => ({ id, purpose })),
    })
  })

  it('publishes populated guidance in the category description and list_subagent_categories', async () => {
    const value = guidance()
    const ctx = await setup({
      provider: 'mock',
      purposeRouting: true,
      purposeRoutes: table(),
      purposeGuidance: value,
    })
    const description = categoryDescription(ctx)
    expect(description).toBe(categoryDescriptionFor(value))
    expect(description).not.toBe(PURPOSE_CATEGORY_DESCRIPTION)
    const listed = await listCategories(ctx, 'guidance-set')
    expect(listed.isError).toBe(false)
    if (listed.isError) return
    const rows = listed.value as { categories: { id: string; purpose: string }[] }
    for (const row of rows.categories) {
      expect(description).toContain(row.purpose)
      expect(row.purpose).toBe(value[row.id as keyof PurposeGuidance])
    }
    const assembly = await ctx.systemPrompt.assemble()
    const tool = assembly.tools.find(item => item.name === 'subagent')
    const assembled = (tool?.parameters as { properties?: Record<string, { description?: string }> }).properties?.category?.description
    expect(assembled).toBe(description)
  })

  it('does not publish a leaking sentence and names the slot when composition runs', async () => {
    const ctx = await setup({ provider: 'mock', purposeRouting: true, purposeRoutes: table() })
    const settings = ctx.get('subagentModelSelection')
    expect(settings).toBeDefined()
    vi.spyOn(settings!, 'purposeGuidance').mockReturnValue(guidance({ review: 'Ask route-review to read it.' }))
    await expect(ctx.systemPrompt.assemble()).rejects.toThrow('purpose guidance slot "review" contains route identifier "route-review"')
    expect(categoryDescription(ctx)).toBe(PURPOSE_CATEGORY_DESCRIPTION)
    expect(categoryDescription(ctx)).not.toContain('route-review')
    const listed = await listCategories(ctx, 'guidance-leak')
    expect(listed.isError).toBe(true)
    expect(text(listed)).not.toContain('route-review')
    expect(text(listed)).toContain('no child model is configured for this tool')
  })

  it('leaves the delegation paragraph unchanged when purpose routing is off', async () => {
    const ctx = await setup({ provider: 'mock' })
    const assembly = await ctx.systemPrompt.assemble()
    const section = assembly.sections.find(item => item.text.startsWith('Start independent delegations'))
    expect(section?.text).toBe('Start independent delegations with `subagent` together in one assistant message and continue useful work while they run. When only waiting for their results remains, end your turn instead of sleeping or polling; the next result starts a new turn.')
    expect(section?.text).not.toContain(PURPOSE_SPLITTING_PARAGRAPH)
  })

  it('appends a non-empty splitting sentence after the fixed paragraph', async () => {
    const ctx = await setup({
      provider: 'mock',
      purposeRouting: true,
      purposeRoutes: table(),
      purposeGuidance: guidance({ splitting: 'Keep one acceptance check in one call.' }),
    })
    const assembly = await ctx.systemPrompt.assemble()
    const section = assembly.sections.find(item => item.text.startsWith('Start independent delegations'))
    expect(section?.text).toContain(`${PURPOSE_SPLITTING_PARAGRAPH}\n\nKeep one acceptance check in one call.`)
  })
})
