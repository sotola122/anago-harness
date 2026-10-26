import { describe, expect, it } from 'vitest'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import {
  MAX_PROMPT_BYTES,
  PI_THINKING_LEVELS,
  assertToolList,
  buildArgv,
  flattenPrompt,
} from '../src/args.ts'
import type { PiArgvOptions } from '../src/args.ts'

/** Default provider-owned options: the posture the design fixes. */
function options(overrides: Partial<PiArgvOptions> = {}): PiArgvOptions {
  return { approve: true, ...overrides }
}

describe('buildArgv', () => {
  it('emits the documented flag order for the default run', () => {
    expect(buildArgv(options(), 'summarize the repository')).toEqual([
      '--print',
      '--mode',
      'json',
      '--approve',
      '--no-session',
      '--',
      'summarize the repository',
    ])
  })

  it('emits every configured option in the documented order', () => {
    expect(buildArgv(
      options({
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        thinking: 'high',
        tools: ['read', 'bash'],
        excludeTools: ['write'],
        approve: false,
        sessionDir: '/var/lib/pi-sessions',
      }),
      'fix the failing test',
    )).toEqual([
      '--print',
      '--mode',
      'json',
      '--provider',
      'anthropic',
      '--model',
      'claude-sonnet-4',
      '--thinking',
      'high',
      '--tools',
      'read,bash',
      '--exclude-tools',
      'write',
      '--no-approve',
      '--session-dir',
      '/var/lib/pi-sessions',
      '--',
      'fix the failing test',
    ])
  })

  it('disables every tool for an explicitly empty allowlist', () => {
    const argv = buildArgv(options({ tools: [] }), 'task')
    expect(argv).toContain('--no-tools')
    expect(argv).not.toContain('--tools')
  })

  it('omits an empty denylist instead of emitting an empty value', () => {
    const argv = buildArgv(options({ excludeTools: [] }), 'task')
    expect(argv).not.toContain('--exclude-tools')
  })

  it('places the task behind the end-of-options marker whatever it spells', () => {
    for (const task of ['--force everything', '-p', '--help', 'help']) {
      const argv = buildArgv(options(), task)
      expect(argv.slice(-2)).toEqual(['--', task])
      expect(argv.indexOf('--')).toBe(argv.length - 2)
    }
  })

  it('accepts every documented thinking level', () => {
    for (const level of PI_THINKING_LEVELS) {
      expect(buildArgv(options({ thinking: level }), 'task')).toContain(level)
    }
  })
})

describe('flattenPrompt', () => {
  const text = (value: string): ContentBlock => ({ type: 'text', text: value })

  it('joins every text block into one task string', () => {
    expect(flattenPrompt([text('summarize '), text('this repository')])).toBe(
      'summarize this repository',
    )
  })

  it('rejects a prompt that is not text-only instead of dropping blocks', () => {
    const prompt: ContentBlock[] = [
      text('look at this'),
      { type: 'reasoning', text: 'thinking about the image' },
    ]
    expect(() => flattenPrompt(prompt)).toThrow(/only text blocks \(found "reasoning"\)/)
  })

  it('rejects an empty prompt and a whitespace-only task', () => {
    expect(() => flattenPrompt([])).toThrow(/at least one text block/)
    expect(() => flattenPrompt([text('   ')])).toThrow(/must not be empty/)
  })

  it('accepts an exact byte bound and rejects one byte over', () => {
    expect(flattenPrompt([text('a'.repeat(MAX_PROMPT_BYTES))])).toHaveLength(MAX_PROMPT_BYTES)
    expect(() => flattenPrompt([text('a'.repeat(MAX_PROMPT_BYTES + 1))]))
      .toThrow(new RegExp(`must not exceed ${MAX_PROMPT_BYTES} UTF-8 bytes`))
  })

  it('counts UTF-8 bytes rather than characters', () => {
    const prompt = 'あ'.repeat(Math.floor(MAX_PROMPT_BYTES / 3) + 1)
    expect(() => flattenPrompt([text(prompt)])).toThrow(/UTF-8 bytes/)
  })
})

describe('assertToolList', () => {
  it('accepts names, globs, and relative add/remove entries', () => {
    expect(() => { assertToolList('tools', ['read', 'mcp__*', '+bash', '-write']) }).not.toThrow()
  })

  it('rejects empty names and comma-separated values', () => {
    expect(() => { assertToolList('tools', ['']) }).toThrow(/empty tool name/)
    expect(() => { assertToolList('excludeTools', ['write,bash']) }).toThrow(/must not contain ","/)
  })
})
