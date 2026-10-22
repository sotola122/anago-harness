import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply, Config, name, inject } from '../src/index.ts'
import type { TuiStartupValues } from '../src/startup.ts'

/** Invocation values used by the non-TTY path. */
const STARTUP: TuiStartupValues = {
  resume: null,
  model: null,
  provider: null,
  theme: null,
  inline: true,
}

describe('tui-app startup guard', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('exports the app row contract', () => {
    expect(name).toBe('tui-app')
    expect(inject).toEqual(['agents', 'tuiStartup', 'appReady', 'appExit'])
    expect(Config({ theme: 'dark', inline: false })).toEqual({ theme: 'dark', inline: false })
  })

  it('refuses to start without a TTY, writes guidance, and exits 1', async () => {
    const ctx = new Context()
    const exited = Promise.withResolvers<number>()
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const originalTty = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: false })
    ctx.provide('appReady', { onReady: (listener) => { listener(); return () => {} } })
    ctx.provide('appExit', (code) => { exited.resolve(code) })
    ctx.provide('tuiStartup', STARTUP)

    apply(ctx, { theme: 'dark', inline: true })

    await expect(exited.promise).resolves.toBe(1)
    const written = stderr.mock.calls.map(call => String(call[0])).join('')
    expect(written).toContain('not a TTY')
    expect(written).toContain('dsh --profile headless')
    expect(written.endsWith('\n')).toBe(true)
    Object.defineProperty(process.stdout, 'isTTY', originalTty ?? { configurable: true, value: undefined })
    await ctx.fiber.dispose()
  })

  it('fails loud when the launcher did not provide the terminal lifecycle', () => {
    const ctx = new Context()
    expect(() => { apply(ctx, { theme: 'dark', inline: true }) }).toThrow('must provide ctx.appReady and ctx.appExit')
    void ctx.fiber.dispose()
  })
})
