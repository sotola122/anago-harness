import { describe, expect, it } from 'vitest'
import type { Context, Volatile } from '@deepseek-ai/cordis'
import type { AssembleContext } from '@deepseek-ai/dsh-system-prompt'
import {
  apply, Config, name, RESPONSE_LANGUAGE_ORDER, RESPONSE_LANGUAGE_SECTION, RESPONSE_LANGUAGE_TEXT,
  responseLanguageText,
} from '../src/index.ts'

interface PromptSection {
  name: string
  order: number
  interpolate: boolean
  text: (context: AssembleContext) => string
}

function fakeContext(sections: PromptSection[]): Context {
  return {
    systemPrompt: { section: (section: PromptSection) => { sections.push(section); return () => {} } },
  } as unknown as Context
}

/** A switch object a test can move; the loader supplies the writable form in production. */
function switchFor(initial: boolean): Volatile<boolean> & { set(value: boolean): void } {
  let value = initial
  return { get: () => value, set: (next: boolean) => { value = next } }
}

const mainAgent = { agent: { session: { header: undefined } } } as unknown as AssembleContext
const shallowAgent = { agent: { session: {} } } as unknown as AssembleContext
const childAgent = { agent: { session: { header: { delegationDepth: 1 } } } } as unknown as AssembleContext

describe('response-language', () => {
  it('declares a stable row name and prompt position', () => {
    expect(name).toBe('response-language')
    expect(RESPONSE_LANGUAGE_SECTION).toBe('response-language')
    expect(RESPONSE_LANGUAGE_ORDER).toBe(9950)
  })

  it('contributes the instruction to main agents only', () => {
    expect(responseLanguageText(mainAgent)).toBe(RESPONSE_LANGUAGE_TEXT)
    expect(responseLanguageText(shallowAgent)).toBe(RESPONSE_LANGUAGE_TEXT)
    expect(responseLanguageText(childAgent)).toBe('')
    expect(responseLanguageText({})).toBe('')
  })

  it('registers a non-interpolated section that follows the live switch', () => {
    const sections: PromptSection[] = []
    const enabled = switchFor(true)
    apply(fakeContext(sections), Config({}))
    apply(fakeContext(sections), { enabled })
    const section = sections[1] as PromptSection
    expect(section.name).toBe(RESPONSE_LANGUAGE_SECTION)
    expect(section.order).toBe(RESPONSE_LANGUAGE_ORDER)
    expect(section.interpolate).toBe(false)
    expect(section.text(mainAgent)).toBe(RESPONSE_LANGUAGE_TEXT)
    enabled.set(false)
    expect(section.text(mainAgent)).toBe('')
    enabled.set(true)
    expect(section.text(mainAgent)).toBe(RESPONSE_LANGUAGE_TEXT)
  })
})
