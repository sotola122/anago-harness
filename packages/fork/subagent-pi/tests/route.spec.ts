/** Per-call Agent route resolution: which Pi flags a delegation selects. */
import { describe, expect, it } from 'vitest'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { resolvePiRoute } from '../src/run.ts'
import type { PiRunSettings } from '../src/run.ts'

/** Baseline provider settings: no route pinned, project files trusted, no session. */
function settings(overrides: Partial<PiRunSettings> = {}): PiRunSettings {
  return {
    providerName: 'pi',
    executable: 'pi',
    env: {},
    disposeGraceMs: 3_000,
    approve: true,
    ...overrides,
  }
}

describe('resolvePiRoute', () => {
  it('keeps the configured route when the call names none', () => {
    const route = resolvePiRoute(settings({ provider: 'openai', model: 'gpt-6-astra', thinking: 'high' }), undefined)
    expect(route).toEqual({ provider: 'openai', model: 'gpt-6-astra', thinking: 'high' })
  })

  it('lets the call override the model and keep the configured provider', () => {
    const route = resolvePiRoute(settings({ provider: 'openai', model: 'gpt-6-astra' }), { model: 'gpt-6-astra-mini' })
    expect(route.provider).toBe('openai')
    expect(route.model).toBe('gpt-6-astra-mini')
  })

  it('lets the call select a complete route and a thinking level', () => {
    const route = resolvePiRoute(settings(), { provider: 'openai', model: 'gpt-6-astra', reasoningEffort: ReasoningEffortId('xhigh') })
    expect(route).toEqual({ provider: 'openai', model: 'gpt-6-astra', thinking: 'xhigh' })
  })

  it('rejects an effort outside the Pi vocabulary instead of ignoring it', () => {
    expect(() => resolvePiRoute(settings({ model: 'm' }), { reasoningEffort: ReasoningEffortId('none') }))
      .toThrow(/not a Pi thinking level/)
  })

  it('rejects a max-tokens request the Pi CLI cannot honor', () => {
    expect(() => resolvePiRoute(settings({ model: 'm' }), { maxTokens: 1_000 }))
      .toThrow(/no max-tokens flag/)
  })

  it('rejects a provider without any model', () => {
    expect(() => resolvePiRoute(settings(), { provider: 'openai' }))
      .toThrow(/without a model/)
  })
})
