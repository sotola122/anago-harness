import { spawn } from 'node:child_process'
import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'
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

/** Real Node fixture that emits the Pi JSONL protocol. */
const FIXTURE = fileURLToPath(new URL('./fixtures/pi-fixture.mjs', import.meta.url))

interface StreamState {
  text: string
}

interface HarnessOptions {
  readonly resolveError?: Error
  readonly spawnError?: Error
  readonly holdExit?: boolean
  readonly real?: boolean
  readonly noResolve?: boolean
  readonly omitStdout?: boolean
  readonly omitStderrReader?: boolean
}

interface ResolveCall {
  readonly command: string
  readonly env: Readonly<Record<string, string>> | undefined
  readonly signal: AbortSignal | undefined
}

interface Harness {
  readonly ctx: Context
  readonly providers: SubagentProvider[]
  readonly specs: SubprocessSpawnSpec[]
  readonly stdout: PassThrough
  readonly stderr: StreamState
  readonly logs: string[]
  readonly resolveCalls: ResolveCall[]
  readonly counts: {
    spawns: number
    signalTerminations: number
    explicitTerminations: number
    waits: number
  }
  complete(exitCode: number | null, signal?: NodeJS.Signals | null): void
  failDone(error: unknown): void
  releaseExit(): void
}

/** Snapshot a stream that was captured as plain text. */
function readerFor(state: StreamState): SubprocessOutputReader {
  return {
    readFrom: () => ({
      text: state.text,
      nextOffset: Buffer.byteLength(state.text, 'utf8'),
      lossy: false,
    }),
  }
}

/** Wait for one event-loop turn so queued stream data is delivered. */
function flush(): Promise<void> {
  return new Promise((resolve) => { setImmediate(resolve) })
}

/**
 * Minimal fake of the two seams. In `real` mode the collected spawn spec is
 * executed as `node <fixture> <pi argv…>` instead of a fake handle, so the
 * protocol mapping runs against real stdout.
 * @param options - injected failures, exit hold, and real-fixture selection.
 * @returns the harness handle.
 */
function createHarness(options: HarnessOptions = {}): Harness {
  const providers: SubagentProvider[] = []
  const specs: SubprocessSpawnSpec[] = []
  const logs: string[] = []
  const resolveCalls: ResolveCall[] = []
  const counts = { spawns: 0, signalTerminations: 0, explicitTerminations: 0, waits: 0 }
  const stdout = new PassThrough()
  const stderr: StreamState = { text: '' }
  const record = (format: unknown): void => {
    logs.push(String(format))
  }

  let settle!: (value: SubprocessOutcome) => void
  let rejectDone!: (error: unknown) => void
  const done = new Promise<SubprocessOutcome>((resolve, reject) => {
    settle = resolve
    rejectDone = reject
  })
  let releaseExit: () => void = () => {}
  const exitGate = new Promise<void>((resolve) => { releaseExit = resolve })

  // Resolve exit facts one turn later: the stream `end` and queued data events
  // must be observed before the process outcome settles.
  const complete = (exitCode: number | null, signal: NodeJS.Signals | null = null): void => {
    stdout.end()
    setImmediate(() => { settle({ exitCode, signal }) })
  }

  const spawnFake = (spec: SubprocessSpawnSpec): SubprocessHandle => {
    counts.spawns += 1
    if (options.spawnError !== undefined) throw options.spawnError
    specs.push(spec)
    spec.signal?.addEventListener('abort', () => {
      counts.signalTerminations += 1
      complete(null, 'SIGTERM')
    }, { once: true })
    return {
      stdin: undefined,
      stdout: options.omitStdout === true ? undefined : stdout,
      stderr: undefined,
      control: undefined,
      collected: options.omitStderrReader === true ? {} : { stderr: readerFor(stderr) },
      done,
      terminate: () => {
        counts.explicitTerminations += 1
        complete(null, 'SIGTERM')
      },
      waitForExit: async () => {
        counts.waits += 1
        if (options.holdExit === true) await exitGate
        return true
      },
    }
  }

  const spawnReal = (spec: SubprocessSpawnSpec): SubprocessHandle => {
    counts.spawns += 1
    specs.push(spec)
    const child = spawn(process.execPath, [FIXTURE, ...spec.argv.slice(1)], {
      cwd: spec.cwd,
      env: spec.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stderrChunks: Buffer[] = []
    child.stderr?.on('data', (chunk: Buffer) => { stderrChunks.push(chunk) })
    const realDone = new Promise<SubprocessOutcome>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (code, signal) => { resolve({ exitCode: code, signal }) })
    })
    spec.signal?.addEventListener('abort', () => { child.kill('SIGTERM') }, { once: true })
    return {
      stdin: undefined,
      stdout: child.stdout ?? undefined,
      stderr: undefined,
      control: undefined,
      collected: {
        stderr: {
          readFrom: () => {
            const text = Buffer.concat(stderrChunks).toString('utf8')
            return { text, nextOffset: Buffer.byteLength(text, 'utf8'), lossy: false }
          },
        },
      },
      done: realDone,
      terminate: () => {
        counts.explicitTerminations += 1
        child.kill('SIGTERM')
      },
      waitForExit: async () => {
        counts.waits += 1
        await realDone.catch(() => {})
        return true
      },
    }
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
      ...options.noResolve === true ? {} : {
        resolveExecutable: async (
          command: string,
          env?: Readonly<Record<string, string>>,
          signal?: AbortSignal,
        ) => {
          resolveCalls.push({ command, env, signal })
          if (options.resolveError !== undefined) throw options.resolveError
          return options.real === true ? FIXTURE : `/resolved/${command}`
        },
      },
      spawn: options.real === true ? spawnReal : spawnFake,
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
    failDone: (error) => { rejectDone(error) },
    releaseExit,
  }
}

/** Build one resolved start request with a text prompt by default. */
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

/** Apply the plugin and start one run against the harness. */
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

/** Write protocol events as newline-delimited JSON. */
function feed(harness: Harness, events: readonly unknown[]): void {
  for (const event of events) harness.stdout.write(`${JSON.stringify(event)}\n`)
}

/** One assistant `message_end` event. */
function assistantEnd(
  text: string,
  stopReason = 'stop',
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    type: 'message_end',
    message: {
      role: 'assistant',
      content: [{ type: 'thinking', thinking: 'private' }, { type: 'text', text }],
      stopReason,
      ...extra,
    },
  }
}

describe('plugin registration', () => {
  it('registers one out-of-process provider under the configured name', () => {
    const harness = createHarness()
    apply(harness.ctx, Config({}))
    expect(harness.providers).toHaveLength(1)
    const provider = harness.providers[0]!
    expect(provider.name).toBe('pi')
    expect(provider.inheritsParentContext).toBe(false)
    expect(provider.capabilities).toEqual({
      agentOptions: true,
      agentPreset: false,
      outputSchema: false,
      depthLimit: false,
    })
    expect('prepareContinuable' in provider).toBe(false)
  })

  it('exposes a route default only when the row pins both halves', () => {
    const pinned = createHarness()
    apply(pinned.ctx, Config({ provider: 'openai', model: 'gpt-6-astra' }))
    expect(pinned.providers[0]!.agentRouteDefaults).toEqual({ provider: 'openai', model: 'gpt-6-astra' })

    const half = createHarness()
    apply(half.ctx, Config({ model: 'gpt-6-astra' }))
    expect(half.providers[0]!.agentRouteDefaults).toBeUndefined()
  })

  it('registers the configured provider name', () => {
    const harness = createHarness()
    apply(harness.ctx, Config({ providerName: 'pi-fast' }))
    expect(harness.providers[0]!.name).toBe('pi-fast')
  })
})

describe('config schema', () => {
  it('declares the documented defaults', () => {
    expect(Config({})).toEqual({
      providerName: 'pi',
      executable: 'pi',
      approve: true,
      env: {},
      disposeGraceMs: 3_000,
    })
  })

  it('rejects an unknown thinking level', () => {
    expect(() => Config({ thinking: 'extreme' } as never)).toThrow()
  })

  it('fails loud on timing bounds instead of clamping them', () => {
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, MAX_TIMER_DELAY_MS + 1]) {
      const harness = createHarness()
      expect(() => { apply(harness.ctx, Config({ timeoutMs: value })) }).toThrow(/timeoutMs/)
      expect(harness.providers).toHaveLength(0)
    }
    const harness = createHarness()
    expect(() => { apply(harness.ctx, Config({ disposeGraceMs: 0 })) }).toThrow(/disposeGraceMs/)
    expect(harness.providers).toHaveLength(0)
  })

  it('rejects a provider without a model because the CLI requires both', () => {
    const harness = createHarness()
    expect(() => { apply(harness.ctx, Config({ provider: 'anthropic' })) })
      .toThrow(/provider requires model/)
    expect(harness.providers).toHaveLength(0)
  })

  it('rejects a relative session directory', () => {
    const harness = createHarness()
    expect(() => { apply(harness.ctx, Config({ sessionDir: 'sessions' })) })
      .toThrow(/sessionDir must be an absolute path/)
    expect(harness.providers).toHaveLength(0)
  })

  it('rejects tool lists that cannot survive comma-separated argv', () => {
    const harness = createHarness()
    expect(() => { apply(harness.ctx, Config({ tools: ['read,bash'] })) }).toThrow(/tools/)
    expect(() => { apply(harness.ctx, Config({ excludeTools: [''] })) }).toThrow(/excludeTools/)
    expect(harness.providers).toHaveLength(0)
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

  it('rejects a prompt that cannot cross the argv boundary', async () => {
    const harness = createHarness()
    apply(harness.ctx, Config({}))
    const provider = harness.providers[0]!
    await expect(provider.start!(makeRequest(new AbortController().signal, { prompt: [] })))
      .rejects.toThrow(/at least one text block/)
    await expect(provider.start!(makeRequest(new AbortController().signal, {
      prompt: [{ type: 'reasoning', text: 'analysis' }],
    }))).rejects.toThrow(/only text blocks/)
    expect(harness.counts.spawns).toBe(0)
  })

  it('rejects with an actionable message when the Pi CLI cannot be found', async () => {
    const harness = createHarness({ resolveError: new Error('ENOENT: not found') })
    apply(harness.ctx, Config({}))
    await expect(harness.providers[0]!.start!(makeRequest(new AbortController().signal)))
      .rejects.toThrow(/cannot find the Pi CLI executable "pi".*pi\.dev/)
    expect(harness.counts.spawns).toBe(0)
  })

  it('rejects a request that was already aborted before startup', async () => {
    const harness = createHarness()
    apply(harness.ctx, Config({}))
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await expect(harness.providers[0]!.start!(makeRequest(controller.signal)))
      .rejects.toThrow(/aborted before the child process started/)
    expect(harness.counts.spawns).toBe(0)
  })

  it('rejects when the spawn itself throws and leaves nothing behind', async () => {
    const harness = createHarness({ spawnError: new Error('EINVAL: bad argv') })
    apply(harness.ctx, Config({}))
    await expect(harness.providers[0]!.start!(makeRequest(new AbortController().signal)))
      .rejects.toThrow(/EINVAL/)
    expect(harness.counts.explicitTerminations).toBe(0)
  })

  it('rejects when the child handle exposes no stdout stream', async () => {
    const harness = createHarness({ omitStdout: true })
    apply(harness.ctx, Config({}))
    await expect(harness.providers[0]!.start!(makeRequest(new AbortController().signal)))
      .rejects.toThrow(/did not expose the child's stdout stream/)
    expect(harness.counts.explicitTerminations).toBe(1)
    expect(harness.counts.waits).toBe(1)
  })
})

describe('executable resolution', () => {
  it('forwards the configured executable and the start signal', async () => {
    const harness = createHarness()
    const { controller } = await startRun(harness, { executable: '/opt/pi/bin/pi' })
    expect(harness.resolveCalls).toEqual([
      { command: '/opt/pi/bin/pi', env: undefined, signal: controller.signal },
    ])
  })

  it('keeps the configured name when the runtime exposes no executable lookup', async () => {
    const harness = createHarness({ noResolve: true })
    const { run } = await startRun(harness)
    expect(harness.specs[0]!.argv[0]).toBe('pi')
    await run.dispose()
  })
})

describe('published run lifecycle', () => {
  it('spawns one CLI child with the fixed stdio, env and grace, then completes', async () => {
    const harness = createHarness()
    const { run } = await startRun(harness, { env: { DSH_PLUGIN_TEST: '1' } })
    const spec = harness.specs[0]!
    expect(spec.argv).toEqual([
      '/resolved/pi',
      '--print',
      '--mode',
      'json',
      '--approve',
      '--no-session',
      '--',
      'summarize this repository',
    ])
    expect(spec.cwd).toBe(WORKSPACE)
    expect(spec.stdio).toEqual({
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: { maxBytes: 65_536 },
    })
    expect(spec.graceMs).toBe(3_000)
    expect(spec.env?.DSH_PLUGIN_TEST).toBe('1')
    expect(typeof spec.env?.PATH).toBe('string')

    feed(harness, [assistantEnd('all done')])
    await flush()
    harness.complete(0)
    await expect(run.result).resolves.toEqual({
      output: [{ type: 'text', text: 'all done' }],
      stopReason: 'completed',
    })
    await run.dispose()
  })

  it('builds the full configured argv', async () => {
    const harness = createHarness()
    const { run } = await startRun(harness, {
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      thinking: 'medium',
      tools: ['read', 'bash'],
      excludeTools: ['write'],
      approve: false,
      sessionDir: `${WORKSPACE}/pi-sessions`,
    })
    expect(harness.specs[0]!.argv).toEqual([
      '/resolved/pi',
      '--print',
      '--mode',
      'json',
      '--provider',
      'anthropic',
      '--model',
      'claude-sonnet-4',
      '--thinking',
      'medium',
      '--tools',
      'read,bash',
      '--exclude-tools',
      'write',
      '--no-approve',
      '--session-dir',
      `${WORKSPACE}/pi-sessions`,
      '--',
      'summarize this repository',
    ])
    feed(harness, [assistantEnd('done')])
    await flush()
    harness.complete(0)
    await expect(run.result).resolves.toMatchObject({ stopReason: 'completed' })
    await run.dispose()
  })

  it('disables tools for an empty allowlist and keeps an empty denylist silent', async () => {
    const harness = createHarness()
    const { run } = await startRun(harness, { tools: [], excludeTools: [] })
    const argv = harness.specs[0]!.argv
    expect(argv).toContain('--no-tools')
    expect(argv).not.toContain('--tools')
    expect(argv).not.toContain('--exclude-tools')
    await run.dispose()
  })

  it('maps a model error stop reason to a masked diagnostic', async () => {
    const harness = createHarness()
    const { run } = await startRun(harness)
    feed(harness, [
      assistantEnd('partial answer', 'error', {
        errorMessage: '429 Too Many Requests: PI_API_KEY=sk-live-secret',
      }),
    ])
    await flush()
    harness.complete(0)
    const result = await run.result
    expect(result.stopReason).toBe('error')
    expect(result.diagnostic).toContain('category: model-error')
    expect(result.diagnostic).not.toContain('sk-live-secret')
    expect(result.output).toEqual([{ type: 'text', text: 'partial answer' }])
    await run.dispose()
  })

  it('maps a non-zero exit without an answer to an error with exit facts', async () => {
    const harness = createHarness()
    const { run } = await startRun(harness)
    harness.complete(2)
    const result = await run.result
    expect(result.stopReason).toBe('error')
    expect(result.diagnostic).toContain('category: exit-code')
    expect(result.diagnostic).toContain('exit code: 2')
    await run.dispose()
  })

  it('maps malformed JSONL to a protocol error', async () => {
    const harness = createHarness()
    const { run } = await startRun(harness)
    harness.stdout.write('not json\n')
    feed(harness, [assistantEnd('answer')])
    await flush()
    harness.complete(0)
    const result = await run.result
    expect(result.stopReason).toBe('error')
    expect(result.diagnostic).toContain('category: protocol')
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

  it('names a non-Error process rejection as unknown instead of trusting its name', async () => {
    const harness = createHarness()
    const { run } = await startRun(harness)
    harness.failDone('spawn EACCES')
    const result = await run.result
    expect(result.stopReason).toBe('error')
    expect(result.diagnostic).toContain('(unknown)')
    await run.dispose()
  })

  it('quotes the masked stderr tail in the diagnostic and the log line', async () => {
    const harness = createHarness()
    const { run } = await startRun(harness)
    harness.stderr.text = 'fatal: PI_API_KEY=sk-live-secret rejected'
    harness.complete(1)
    const result = await run.result
    expect(result.diagnostic).toContain('category: exit-code')
    expect(result.diagnostic).toContain('stderr tail:')
    expect(result.diagnostic).toContain('[redacted]')
    expect(result.diagnostic).not.toContain('sk-live-secret')
    expect(harness.logs.join('\n')).toContain('[redacted]')
    expect(harness.logs.join('\n')).not.toContain('sk-live-secret')
    await run.dispose()
  })

  it('omits the stderr tail when the child handle keeps no reader', async () => {
    const harness = createHarness({ omitStderrReader: true })
    const { run } = await startRun(harness)
    harness.complete(1)
    const result = await run.result
    expect(result.stopReason).toBe('error')
    expect(harness.logs.join('\n')).toContain('child failed')
    expect(harness.logs.join('\n')).not.toContain('stderr tail')
    await run.dispose()
  })

  it('keeps the partial output when the parent cancels', async () => {
    const harness = createHarness()
    const { run, controller } = await startRun(harness)
    feed(harness, [assistantEnd('partial text')])
    await flush()
    controller.abort(new Error('parent cancelled'))
    const result = await run.result
    expect(result.stopReason).toBe('aborted')
    expect(result.output).toEqual([{ type: 'text', text: 'partial text' }])
    expect(result.diagnostic).toBeUndefined()
    expect(harness.counts.signalTerminations).toBe(1)
    await run.dispose()
  })

  it('reports aborted with a timeout diagnostic when the deadline elapses', async () => {
    const harness = createHarness()
    const { run } = await startRun(harness, { timeoutMs: 25 })
    const result = await run.result
    expect(result.stopReason).toBe('aborted')
    expect(result.diagnostic).toContain('category: timeout')
    expect(result.diagnostic).toContain('25 ms')
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

  it('teardown awaits real process quiescence before dispose resolves', async () => {
    const harness = createHarness({ holdExit: true })
    const { run } = await startRun(harness)
    let disposed = false
    const disposal = run.dispose()
    void disposal.then(() => { disposed = true })
    await flush()
    expect(disposed).toBe(false)
    harness.releaseExit()
    await disposal
    expect(disposed).toBe(true)
    expect(harness.counts.explicitTerminations).toBe(1)
    expect(harness.counts.waits).toBe(1)
  })
})

describe('real JSONL fixture', () => {
  it('completes with the assistant text and proves argv plus env delivery', async () => {
    const harness = createHarness({ real: true })
    const { run } = await startRun(harness, { env: { PI_FIXTURE_MODE: 'success' } })
    await expect(run.result).resolves.toEqual({
      output: [{ type: 'text', text: 'done: summarize this repository' }],
      stopReason: 'completed',
    })
    await run.dispose()
  })

  it('delivers a dash-led task as the prompt behind the end-of-options marker', async () => {
    const harness = createHarness({ real: true })
    const { run } = await startRun(
      harness,
      { env: { PI_FIXTURE_MODE: 'success' } },
      { prompt: [{ type: 'text', text: '--force everything' }] },
    )
    await expect(run.result).resolves.toEqual({
      output: [{ type: 'text', text: 'done: --force everything' }],
      stopReason: 'completed',
    })
    await run.dispose()
  })

  it('fails on a stream error stop reason and masks its message', async () => {
    const harness = createHarness({ real: true })
    const { run } = await startRun(harness, { env: { PI_FIXTURE_MODE: 'error' } })
    const result = await run.result
    expect(result.stopReason).toBe('error')
    expect(result.diagnostic).toContain('category: model-error')
    expect(result.diagnostic).not.toContain('sk-fixture-secret')
    await run.dispose()
  })

  it('fails on a non-zero exit without an assistant message', async () => {
    const harness = createHarness({ real: true })
    const { run } = await startRun(harness, { env: { PI_FIXTURE_MODE: 'exit' } })
    const result = await run.result
    expect(result.stopReason).toBe('error')
    expect(result.diagnostic).toContain('category: exit-code')
    expect(result.diagnostic).toContain('exit code: 2')
    await run.dispose()
  })

  it('fails closed on a malformed protocol line', async () => {
    const harness = createHarness({ real: true })
    const { run } = await startRun(harness, { env: { PI_FIXTURE_MODE: 'malformed' } })
    const result = await run.result
    expect(result.stopReason).toBe('error')
    expect(result.diagnostic).toContain('category: protocol')
    await run.dispose()
  })

  it('maps the token ceiling to max-tokens', async () => {
    const harness = createHarness({ real: true })
    const { run } = await startRun(harness, { env: { PI_FIXTURE_MODE: 'max-tokens' } })
    await expect(run.result).resolves.toEqual({
      output: [{ type: 'text', text: 'cut off' }],
      stopReason: 'max-tokens',
    })
    await run.dispose()
  })
})
