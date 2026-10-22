import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply, name, TUI_STARTUP_SERVICE, type TuiStartupValues } from '../src/startup.ts'

/**
 * Parse one inner argument list through the startup row.
 * @param args - invocation arguments after `dsh --profile tui`.
 * @returns the provided service value and the exit code it requested, if any.
 */
function parse(args: readonly string[]): { startup: TuiStartupValues | undefined; code: number | undefined } {
  const ctx = new Context()
  let code: number | undefined
  ctx.provide('cmdlineArgs', { get: () => args })
  ctx.provide('appExit', (exitCode: number) => { code = exitCode })
  apply(ctx)
  const startup = ctx.get(TUI_STARTUP_SERVICE)
  void ctx.fiber.dispose()
  return { startup, code }
}

describe('tui-startup row', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('exports the startup row contract', () => {
    expect(name).toBe('tui-startup')
    expect(TUI_STARTUP_SERVICE).toBe('tuiStartup')
  })

  it('defaults every override to absent', () => {
    expect(parse([]).startup).toEqual({
      resume: null,
      model: null,
      provider: null,
      theme: null,
      inline: false,
    })
  })

  it('parses the flag family', () => {
    expect(parse([
      '--resume', 'session-1',
      '--model', 'deepseek-v4',
      '--provider', 'deepseek',
      '--theme', 'light',
      '--inline',
    ]).startup).toEqual({
      resume: 'session-1',
      model: 'deepseek-v4',
      provider: 'deepseek',
      theme: 'light',
      inline: true,
    })
  })

  it('rejects an unsupported theme with a usage exit', () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const result = parse(['--theme', 'solarized'])
    expect(result.startup).toBeUndefined()
    expect(result.code).toBe(1)
  })

  it('rejects an empty resume id with a usage exit', () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const result = parse(['--resume', ''])
    expect(result.startup).toBeUndefined()
    expect(result.code).toBe(1)
  })
})
