import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { TuiApp } from '../src/app/root.ts'
import { apply } from '../src/index.ts'
import type { TuiStartupValues } from '../src/startup.ts'

/** Invocation values used by the boot tests. */
const STARTUP: TuiStartupValues = {
  resume: 'session-1',
  model: null,
  provider: null,
  theme: null,
  inline: true,
}

/** One boot test's context and the effects its fakes recorded. */
interface BootHarness {
  readonly ctx: Context
  readonly readCalled: Promise<boolean>
  readonly resolveRead: () => void
  readonly exitCodes: number[]
  readonly dispose: ReturnType<typeof vi.fn>
  readonly signalHandler: () => NodeJS.SignalsListener | undefined
}

/**
 * Provide the fake terminal lifecycle, Agent, and a resume read that stays
 * pending until the test resolves it.
 * @param selection - whether to mount the default-model service.
 * @returns the context and the observations the test asserts.
 */
function harness(selection: { provider: string; model: string } | undefined): BootHarness {
  const ctx = new Context()
  const read = Promise.withResolvers<{ readonly events: readonly unknown[] }>()
  const called = Promise.withResolvers<boolean>()
  const exitCodes: number[] = []
  const dispose = vi.fn(async () => {})
  const listenersBefore = new Set(process.listeners('SIGINT'))
  const agent = {
    id: 'agent-1',
    session: { id: SessionId('session-1') },
    options: { provider: 'deepseek', model: 'deepseek-flash' },
    status: 'idle',
  }
  ctx.provide('agents', {
    create: async () => { throw new Error('the resume invocation must not create a Session') },
    resume: async () => ({ agent, dispose }),
  } as never)
  if (selection !== undefined) {
    ctx.provide('agentDefaultModel', { currentSelection: () => selection } as never)
  }
  ctx.provide('sessionQuery', {
    readSession: () => {
      called.resolve(true)
      return read.promise
    },
  } as never)
  ctx.provide('appReady', { onReady: (listener: () => void) => { listener(); return () => {} } })
  ctx.provide('appExit', (code: number) => { exitCodes.push(code) })
  ctx.provide('tuiStartup', STARTUP)
  apply(ctx, { theme: 'dark', inline: true })
  return {
    ctx,
    readCalled: called.promise,
    resolveRead: () => { read.resolve({ events: [] }) },
    exitCodes,
    dispose,
    signalHandler: () => process.listeners('SIGINT').find(listener => !listenersBefore.has(listener)),
  }
}

/**
 * Let every microtask queued by a resolved read run.
 * @returns a promise settled after the next macrotask turn.
 */
function settle(): Promise<void> {
  return new Promise((resolve) => { setImmediate(resolve) })
}

describe('tui-app boot termination', () => {
  const originalTty = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')

  beforeEach(() => {
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(process.stdout, 'isTTY', originalTty ?? { configurable: true, value: undefined })
  })

  it('fails once with actionable guidance when no default and no override name a route', async () => {
    const ctx = new Context()
    const exitCodes: number[] = []
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    ctx.provide('appReady', { onReady: (listener: () => void) => { listener(); return () => {} } })
    ctx.provide('appExit', (code: number) => { exitCodes.push(code) })
    ctx.provide('tuiStartup', { ...STARTUP, resume: null })

    apply(ctx, { theme: 'dark', inline: true })
    await settle()

    expect(exitCodes).toEqual([1])
    const written = stderr.mock.calls.map(call => String(call[0])).join('')
    expect(written).toContain('no provider/model configured')
    expect(written).toContain('agentDefaultModel')
    expect(written).toContain('--provider')
    expect(written).toContain('--model')
    expect(written.match(/\n/g)).toHaveLength(1)
    await ctx.fiber.dispose()
  })

  it('never starts the UI when shutdown lands during resume replay', async () => {
    const start = vi.spyOn(TuiApp.prototype, 'start').mockImplementation(() => {})
    const boot = harness({ provider: 'deepseek', model: 'deepseek-flash' })
    await boot.readCalled

    const handler = boot.signalHandler()
    expect(handler).toBeDefined()
    handler?.('SIGINT')
    await vi.waitFor(() => { expect(boot.exitCodes).toEqual([0]) })
    expect(boot.dispose).toHaveBeenCalledTimes(1)

    boot.resolveRead()
    await settle()

    expect(start).not.toHaveBeenCalled()
    expect(boot.exitCodes).toEqual([0])
    expect(boot.dispose).toHaveBeenCalledTimes(1)
    await boot.ctx.fiber.dispose()
  })

  it('never starts the UI when the row is disposed during resume replay', async () => {
    const start = vi.spyOn(TuiApp.prototype, 'start').mockImplementation(() => {})
    const boot = harness({ provider: 'deepseek', model: 'deepseek-flash' })
    await boot.readCalled

    await boot.ctx.fiber.dispose()
    expect(boot.exitCodes).toEqual([])
    expect(boot.dispose).toHaveBeenCalledTimes(1)

    boot.resolveRead()
    await settle()

    expect(start).not.toHaveBeenCalled()
    expect(boot.exitCodes).toEqual([])
    expect(boot.dispose).toHaveBeenCalledTimes(1)
  })
})
