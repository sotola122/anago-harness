import { describe, expect, it } from 'vitest'
import { addUsage, EMPTY_USAGE, formatTokens, formatUsage, hasUsage } from '../src/projection/usage.ts'

describe('turn usage', () => {
  it('starts empty and reports no usage', () => {
    expect(hasUsage(EMPTY_USAGE)).toBe(false)
    expect(formatUsage(EMPTY_USAGE)).toBe('')
  })

  it('accumulates every reported request in a turn', () => {
    const once = addUsage(EMPTY_USAGE, { inputTokens: 1_200, outputTokens: 300 })
    const twice = addUsage(once, { inputTokens: 800, outputTokens: 45, reasoningTokens: 12 })
    expect(twice).toEqual({ inputTokens: 2_000, outputTokens: 345, reasoningTokens: 12, requests: 2 })
    expect(hasUsage(twice)).toBe(true)
    expect(formatUsage(twice)).toBe('in 2.0k · out 345 (12 reasoning)')
  })

  it('keeps exact counts below one thousand', () => {
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(999)).toBe('999')
    expect(formatTokens(1_050)).toBe('1.1k')
    expect(formatTokens(12_400)).toBe('12k')
  })

  it('omits the reasoning parenthetical when the provider reports none', () => {
    expect(formatUsage({ inputTokens: 10, outputTokens: 20, reasoningTokens: 0, requests: 1 }))
      .toBe('in 10 · out 20')
  })
})
