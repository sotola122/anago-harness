import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type {
  ResolvedSubagentStartRequest,
  SubagentProvider,
  SubagentRun,
} from '@deepseek-ai/dsh-subagent'
import type {
  SubprocessHandle,
  SubprocessOutcome,
  SubprocessOutputReader,
  SubprocessSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { Config, apply } from '../src/index.ts'

/** Absolute, existing directory used as the delegating workspace. */
const WORKSPACE = process.cwd()

interface StreamState {
  text: string
  truncated: boolean
  spillPath?: string
}

interface Harness {
  readonly ctx: Context
  readonly providers: SubagentProvider[]
  readonly specs: SubprocessSpawnSpec[]
  readonly stdout: StreamState
  readonly stderr: StreamState
  readonly logs: string[]
  readonly resolveCalls: {
    readonly command: string
    readonly env: Readonly<Record<string, string>> | undefined
    readonly signal: AbortSignal | undefined
  }[]
  readonly counts: {
    spawns: number
    signalTerminations: number
    explicitTerminations: number
    waits: number
  }
  complete(exitCode: number | null, signal?: NodeJS.Signals | null): void
  failDone(error: Error): void
}

function readerFor(state: StreamState): SubprocessOutputReader {
  return {
    readFrom: () => ({
      text: state.text,
      nextOffset: Buffer.byteLength(state.text, 'utf8'),
      lossy: state.truncated,
      ...(state.spillPath === undefined ? {} : { spillPath: state.spillPath }),
    }),
  }
}

/** Minimal fake of the two seams; no child process is ever created. */
function createHarness(
  options: { resolveError?: Error; spawnError?: Error; resolveHonoursSignal?: boolean } = {},
): Harness {
  const providers: SubagentProvider[] = []
  const specs: SubprocessSpawnSpec[] = []
  const stdout: StreamState = { text: '', truncated: false }
  const stderr: StreamState = { text: '', truncated: false }
  const counts = { spawns: 0, signalTerminations: 0, explicitTerminations: 0, waits: 0 }
  const logs: string[] = []
  const resolveCalls: Harness['resolveCalls'] = []
  const record = (format: unknown): void => {
    logs.push(String(format))
  }
  let settle!: (value: SubprocessOutcome) => void
  let rejectDone!: (error: Error) => void
  const done = new Promise<SubprocessOutcome>((resolve, reject) => {
    settle = resolve
    rejectDone = reject
  })
  const complete = (exitCode: number | null, signal: NodeJS.Signals | null = null): void => {
    settle({ exitCode, signal })
  }
  const handle: SubprocessHandle = {
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    control: undefined,
    collected: { stdout: readerFor(stdout), stderr: readerFor(stderr) },
    done,
    terminate: () => {
      counts.explicitTerminations += 1
      complete(null, 'SIGTERM')
    },
    waitForExit: async () => {
      counts.waits += 1
      return true
    },
  }
  const ctx = {
    effect: (execute: () => unknown) => {
      const disposer = execute()
      return () => {
        if (typeof disposer === 'function') (disposer as () => void)()
      }
    },
    subagents: {
      registerProvider: (provider: SubagentProvider) => {
        providers.push(provider)
        return () => {}
      },
    },
    subprocess: {
      resolveExecutable: async (
        command: string,
        env?: Readonly<Record<string, string>>,
        signal?: AbortSignal,
      ) => {
        resolveCalls.push({ command, env, signal })
        if (options.resolveError !== undefined) throw options.resolveError
        if (options.resolveHonoursSignal === true && signal?.aborted === true) {
          throw new Error('The operation was aborted')
        }
        return `/resolved/${command}`
      },
      spawn: (spec: SubprocessSpawnSpec) => {
        counts.spawns += 1
        if (options.spawnError !== undefined) throw options.spawnError
        specs.push(spec)
        spec.signal?.addEventListener(
          'abort',
          () => {
            counts.signalTerminations += 1
            complete(null, 'SIGTERM')
          },
          { once: true },
        )
        return handle
      },
    },
    logger: { info: record, warn: record, debug: record, error: record },
  } as unknown as Context
  return {
    ctx,
    providers,
    specs,
    stdout,
    stderr,
    logs,
    resolveCalls,
    counts,
    complete,
    failDone: (error) =>{  rejectDone(error) },
  }
}

function makeRequest(
  signal: AbortSignal,
  overrides: Partial<ResolvedSubagentStartRequest> = {},
): ResolvedSubagentStartRequest {
  return {
    cwd: WORKSPACE,
    prompt: [{ type: 'text', text: 'summarize this repository' }],
    parent: undefined,
    signal,
    ...overrides,
  } as unknown as ResolvedSubagentStartRequest
}

interface Started {
  readonly run: SubagentRun
  readonly controller: AbortController
  readonly provider: SubagentProvider
}

async function startRun(
  harness: Harness,
  config: Partial<Config> = {},
  overrides: Partial<ResolvedSubagentStartRequest> = {},
): Promise<Started> {
  apply(harness.ctx, Config(config))
  const provider = harness.providers[0]!
  const controller = new AbortController()
  const run = await provider.start!(makeRequest(controller.signal, overrides))
  return { run, controller, provider }
}

describe('plugin registration', () => {
  it('registers one out-of-process provider under the configured name', () => {
    const harness = createHarness()
    apply(harness.ctx, Config({ providerName: 'cursor' }))
    expect(harness.providers).toHaveLength(1)
    const provider = harness.providers[0]!
    expect(provider.name).toBe('cursor')
    expect(provider.inheritsParentContext).toBe(false)
    expect(provider.capabilities).toEqual({
      agentOptions: false,
      agentPreset: false,
      outputSchema: false,
      depthLimit: false,
    })
    expect('prepareContinuable' in provider).toBe(false)
  })
})

describe('config schema', () => {
  it('declares the documented defaults', () => {
    expect(Config({})).toEqual({
      providerName: 'cursor',
      agentBinary: 'agent',
      outputFormat: 'json',
      mode: 'agent',
      sandbox: true,
      force: false,
      trust: true,
      timeoutMs: 600_000,
      disposeGraceMs: 3_000,
      stdoutMaxBytes: 4_194_304,
      stdoutSpillMaxBytes: 67_108_864,
      stderrMaxBytes: 65_536,
      env: {},
      extraArgs: [],
    })
  })

  it('rejects an unknown mode or output format', () => {
    expect(() => Config({ mode: 'bogus' } as never)).toThrow()
    expect(() => Config({ outputFormat: 'yaml' } as never)).toThrow()
  })

  it('fails loud on timing bounds instead of clamping them', () => {
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, MAX_TIMER_DELAY_MS + 1]) {
      const harness = createHarness()
      expect(() =>{  apply(harness.ctx, Config({ timeoutMs: value })) }).toThrow(/timeoutMs/)
    }
    const harness = createHarness()
    expect(() =>{  apply(harness.ctx, Config({ disposeGraceMs: 0 })) }).toThrow(/disposeGraceMs/)
    expect(harness.providers).toHaveLength(0)
  })

  it('fails loud on non-positive byte limits', () => {
    const cases: readonly [string, Partial<Config>][] = [
      ['stdoutMaxBytes', { stdoutMaxBytes: 0 }],
      ['stdoutSpillMaxBytes', { stdoutSpillMaxBytes: -1 }],
      ['stderrMaxBytes', { stderrMaxBytes: Number.NaN }],
    ]
    for (const [field, config] of cases) {
      const harness = createHarness()
      expect(() =>{  apply(harness.ctx, Config(config)) }).toThrow(
        new RegExp(`${field} must be a positive safe integer`),
      )
      expect(harness.providers).toHaveLength(0)
    }
  })
})

describe('start failures before publication', () => {
  it('rejects an unusable child cwd without spawning', async () => {
    const harness = createHarness()
    apply(harness.ctx, Config({}))
    const provider = harness.providers[0]!
    await expect(
      provider.start!(makeRequest(new AbortController().signal, { cwd: 'relative/child' })),
    ).rejects.toThrow(/child cwd/)
    await expect(
      provider.start!(makeRequest(new AbortController().signal, { cwd: `${WORKSPACE}/missing-dir` })),
    ).rejects.toThrow(/child cwd/)
    expect(harness.counts.spawns).toBe(0)
  })

  it('rejects when the Cursor CLI executable cannot be resolved', async () => {
    const harness = createHarness({ resolveError: new Error('ENOENT: not found') })
    const controller = new AbortController()
    apply(harness.ctx, Config({}))
    await expect(harness.providers[0]!.start!(makeRequest(controller.signal))).rejects.toThrow(
      /cannot resolve the Cursor CLI executable "agent"/,
    )
    expect(harness.counts.spawns).toBe(0)
  })

  it('rejects extraArgs that restate a provider-owned flag', async () => {
    const harness = createHarness()
    apply(harness.ctx, Config({ extraArgs: ['--sandbox', 'disabled'] }))
    await expect(harness.providers[0]!.start!(makeRequest(new AbortController().signal))).rejects.toThrow(
      /provider-owned flag "--sandbox"/,
    )
    expect(harness.counts.spawns).toBe(0)
  })

  it('rejects a task that begins with a dash', async () => {
    const harness = createHarness()
    apply(harness.ctx, Config({}))
    await expect(
      harness.providers[0]!.start!(
        makeRequest(new AbortController().signal, {
          prompt: [{ type: 'text', text: '--force everything' }],
        }),
      ),
    ).rejects.toThrow(/must not begin with "-"/)
    expect(harness.counts.spawns).toBe(0)
  })

  it('rejects a task that is a CLI subcommand name instead of delegating it', async () => {
    const harness = createHarness()
    apply(harness.ctx, Config({}))
    await expect(
      harness.providers[0]!.start!(
        makeRequest(new AbortController().signal, {
          prompt: [{ type: 'text', text: 'logout' }],
        }),
      ),
    ).rejects.toThrow(/collides with the Cursor CLI subcommand "logout"/)
    expect(harness.counts.spawns).toBe(0)
  })

  it('rejects when the spawn itself throws and leaves nothing behind', async () => {
    const harness = createHarness({ spawnError: new Error('EINVAL: bad argv') })
    apply(harness.ctx, Config({}))
    await expect(harness.providers[0]!.start!(makeRequest(new AbortController().signal))).rejects.toThrow(
      /EINVAL/,
    )
    expect(harness.counts.explicitTerminations).toBe(0)
  })

  it('rejects a request that was already aborted before startup', async () => {
    const harness = createHarness()
    apply(harness.ctx, Config({}))
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await expect(harness.providers[0]!.start!(makeRequest(controller.signal))).rejects.toThrow(
      /aborted before the child process started/,
    )
    expect(harness.counts.spawns).toBe(0)
  })
})

describe('executable resolution cancellation', () => {
  it('forwards the start request signal to resolveExecutable', async () => {
    const harness = createHarness()
    const { controller } = await startRun(harness)
    expect(harness.resolveCalls).toHaveLength(1)
    expect(harness.resolveCalls[0]!.command).toBe('agent')
    expect(harness.resolveCalls[0]!.env).toBeUndefined()
    expect(harness.resolveCalls[0]!.signal).toBe(controller.signal)
  })

  it('forwards the configured binary name with the signal', async () => {
    const harness = createHarness()
    const { controller } = await startRun(harness, { agentBinary: '/opt/cursor/agent' })
    expect(harness.resolveCalls[0]!.command).toBe('/opt/cursor/agent')
    expect(harness.resolveCalls[0]!.signal).toBe(controller.signal)
  })

  it('rejects before spawning when the lookup observes an already aborted signal', async () => {
    const harness = createHarness({ resolveHonoursSignal: true })
    apply(harness.ctx, Config({}))
    const controller = new AbortController()
    controller.abort(new Error('cancelled while resolving'))
    await expect(harness.providers[0]!.start!(makeRequest(controller.signal))).rejects.toThrow(
      /cannot resolve the Cursor CLI executable "agent"/,
    )
    expect(harness.resolveCalls[0]!.signal).toBe(controller.signal)
    expect(harness.counts.spawns).toBe(0)
  })
})

describe('published run lifecycle', () => {
  it('spawns one CLI child with the fixed stdio, env and grace, then completes', async () => {
    const harness = createHarness()
    const { run } = await startRun(harness, { env: { DSH_PLUGIN_TEST: '1' } })
    const spec = harness.specs[0]!
    expect(spec.argv).toEqual([
      '/resolved/agent',
      '--print',
      '--output-format',
      'json',
      '--sandbox',
      'enabled',
      '--trust',
      '--workspace',
      WORKSPACE,
      'agent',
      'summarize this repository',
    ])
    expect(spec.cwd).toBe(WORKSPACE)
    expect(spec.stdio).toEqual({
      stdin: 'ignore',
      stdout: { maxBytes: 4_194_304, spill: { maxBytes: 67_108_864 } },
      stderr: { maxBytes: 65_536 },
    })
    expect(spec.graceMs).toBe(3_000)
    expect(spec.env?.DSH_PLUGIN_TEST).toBe('1')
    expect(typeof spec.env?.PATH).toBe('string')

    harness.stdout.text = '{"result":"all done"}'
    harness.complete(0)
    await expect(run.result).resolves.toEqual({
      output: [{ type: 'text', text: 'all done' }],
      stopReason: 'completed',
    })
    await run.dispose()
  })

  it('spawns a subcommand-looking task behind the explicit agent command word', async () => {
    const harness = createHarness()
    const { run } = await startRun(harness, {}, {
      prompt: [{ type: 'text', text: 'help me fix the failing test' }],
    })
    expect(harness.specs[0]!.argv.slice(-2)).toEqual(['agent', 'help me fix the failing test'])
    harness.stdout.text = '{"result":"fixed"}'
    harness.complete(0)
    await expect(run.result).resolves.toMatchObject({
      output: [{ type: 'text', text: 'fixed' }],
      stopReason: 'completed',
    })
    await run.dispose()
  })

  it('maps an is_error payload to an error result with a diagnostic', async () => {
    const harness = createHarness()
    const { run } = await startRun(harness)
    harness.stdout.text = '{"is_error":true,"result":"CURSOR_API_KEY=abc123 refused"}'
    harness.complete(0)
    const result = await run.result
    expect(result.stopReason).toBe('error')
    expect(result.diagnostic).toContain('category: product-error')
    expect(result.diagnostic).not.toContain('abc123')
    await run.dispose()
  })

  it('maps a non-zero exit to an error result with structured fields', async () => {
    const harness = createHarness()
    const { run } = await startRun(harness)
    harness.stdout.text = 'partial output'
    harness.complete(2)
    const result = await run.result
    expect(result.stopReason).toBe('error')
    expect(result.diagnostic).toBe(
      'subagent-cursor child failure (stage: run; category: exit-code; exit code: 2)',
    )
    expect(result.output).toEqual([{ type: 'text', text: 'partial output' }])
    await run.dispose()
  })

  it('reports a parse failure when the tail cannot be recovered from a spill file', async () => {
    const harness = createHarness()
    const { run } = await startRun(harness)
    harness.stdout.text = 'l text"}'
    harness.stdout.truncated = true
    harness.stdout.spillPath = `${WORKSPACE}/dsh-subagent-cursor-missing.spill`
    harness.complete(0)
    const result = await run.result
    expect(result.stopReason).toBe('error')
    expect(result.diagnostic).toContain('category: parse')
    expect(result.diagnostic).toContain('truncated')
    await run.dispose()
  })

  it('flattens an unobservable process into an error result', async () => {
    const harness = createHarness()
    const { run } = await startRun(harness)
    harness.failDone(new Error('spawn EACCES'))
    const result = await run.result
    expect(result.stopReason).toBe('error')
    expect(result.diagnostic).toContain('category: process')
    await run.dispose()
  })

  it('keeps raw stderr out of the diagnostic and masks it in the log line', async () => {
    const harness = createHarness()
    const { run } = await startRun(harness)
    harness.stderr.text = 'fatal: CURSOR_API_KEY=abc123 rejected'
    harness.stdout.text = 'not json'
    harness.complete(0)
    const result = await run.result
    expect(result.diagnostic).toContain('category: parse')
    expect(result.diagnostic).not.toContain('abc123')
    expect(harness.logs.join('\n')).toContain('CURSOR_API_KEY=«redacted»')
    expect(harness.logs.join('\n')).not.toContain('abc123')
    await run.dispose()
  })

  it('reports aborted without a diagnostic when the parent cancels', async () => {    const harness = createHarness()
    const { run, controller } = await startRun(harness)
    controller.abort(new Error('parent cancelled'))
    const result = await run.result
    expect(result.stopReason).toBe('aborted')
    expect(result.diagnostic).toBeUndefined()
    expect(harness.counts.signalTerminations).toBe(1)
    await run.dispose()
  })

  it('reports aborted with a timeout diagnostic when the deadline elapses', async () => {
    const harness = createHarness()
    const { run } = await startRun(harness, { timeoutMs: 30 })
    const result = await run.result
    expect(result.stopReason).toBe('aborted')
    expect(result.diagnostic).toContain('category: timeout')
    expect(result.diagnostic).toContain('30 ms')
    expect(harness.counts.signalTerminations).toBe(1)
    await run.dispose()
  })

  it('settles as aborted and tears down idempotently on dispose', async () => {
    const harness = createHarness()
    const { run } = await startRun(harness)
    const first = run.dispose()
    const second = run.dispose()
    expect(first).toBe(second)
    await first
    expect(harness.counts.explicitTerminations).toBe(1)
    expect(harness.counts.waits).toBe(1)
    await expect(run.result).resolves.toMatchObject({ stopReason: 'aborted' })
  })
})
