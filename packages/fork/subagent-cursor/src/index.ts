/**
 * Profile-named Cursor Agent CLI (`agent`) one-shot subagent provider.
 *
 * Every accepted run starts exactly one `agent --print` child in the
 * delegating Session's workspace, publishes it through the shared subagent
 * seam, and maps only a parseable, non-error JSON payload (or a clean
 * `--output-format text` run) to `completed`. Failures before publication
 * reject `start()`; failures after publication settle as `stopReason`.
 *
 * The child runs as a host process outside the DSH file sandbox (the CLI needs
 * `$HOME` for its own state), so the provider's safety posture is: always
 * `--sandbox enabled`, never `--force` unless configured, `--workspace` fixed
 * to the parent's child cwd, no credentials in `env`, and a hard rejection of
 * `extraArgs` that restate a provider-owned flag.
 *
 * @module @anago-harness/subagent-cursor
 */
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { AgentOptions } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import z from '@deepseek-ai/schemastery'
import {
  NO_START_CAPABILITIES,
  assertPositiveFinite,
  assertUsableCwd,
  settleRunResult,
  subprocessRunHandle,
} from '@deepseek-ai/dsh-subagent'
import type {
  ResolvedSubagentStartRequest,
  SubagentCapabilities,
  SubagentProvider,
  SubagentResult,
  SubagentRun,
} from '@deepseek-ai/dsh-subagent'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { MAX_TIMER_DELAY_MS, deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'
import { buildArgv, flattenPrompt } from './args.ts'
import type { ExecutionMode, OutputFormat } from './args.ts'
import { formatDiagnostic, maskSecrets, truncateUtf8 } from './diagnostic.ts'
import { parseOutcome, readCollectedStream, recoverCollectedOutput, textOutput } from './parse.ts'

/** Cordis plugin name. */
export const name = 'subagent-cursor'

/** Services required before the provider can register. */
export const inject = ['subagents', 'subprocess']

/** Diagnostic prefix shared by every provider failure. */
const PREFIX = 'subagent-cursor'

/** Timeout code carried by the fused per-run deadline. */
const TIMEOUT_CODE = 'SUBAGENT_CURSOR_TIMEOUT'

const DEFAULT_PROVIDER_NAME = 'cursor'
const DEFAULT_AGENT_BINARY = 'agent'
const DEFAULT_OUTPUT_FORMAT: OutputFormat = 'json'
const DEFAULT_MODE: ExecutionMode = 'agent'
const DEFAULT_TIMEOUT_MS = 600_000
const DEFAULT_DISPOSE_GRACE_MS = 3_000
const DEFAULT_STDOUT_MAX_BYTES = 4_194_304
const DEFAULT_STDOUT_SPILL_MAX_BYTES = 67_108_864
const DEFAULT_STDERR_MAX_BYTES = 65_536

/** Byte budget for the stderr tail quoted into the harness log line. */
const LOG_STDERR_MAX_BYTES = 512

/**
 * Provider configuration (see the package README for the field table).
 *
 * The schema applies every default, so a value of this type is complete; a
 * `cordis.yml` row may omit any field.
 */
export interface Config {
  /** Registry name inside `ctx.subagents`; must be unique per composition. */
  providerName: string
  /** Cursor CLI executable resolved through `ctx.subprocess.resolveExecutable`. */
  agentBinary: string
  /** Optional `--model` value; omitted uses the CLI default. */
  model?: string
  /** `--output-format` value; `text` is the unverified-JSON-schema escape hatch. */
  outputFormat: OutputFormat
  /** Execution mode; `agent` emits no `--mode`. */
  mode: ExecutionMode
  /** Emit `--sandbox enabled` (true) or `disabled` (false, diagnostics only). */
  sandbox: boolean
  /** Emit `--force` (Run Everything); off by default. */
  force: boolean
  /** Emit `--trust` to skip the workspace trust prompt in print mode. */
  trust: boolean
  /** Per-run wall-clock budget in milliseconds. */
  timeoutMs: number
  /** SIGTERM-to-SIGKILL grace handed to the subprocess provider. */
  disposeGraceMs: number
  /** In-memory stdout cap; overflow keeps the tail only. */
  stdoutMaxBytes: number
  /** Full-stdout spill cap used to recover a truncated JSON payload. */
  stdoutSpillMaxBytes: number
  /** In-memory stderr cap used for the log-only diagnostic tail. */
  stderrMaxBytes: number
  /** Extra environment variables layered over the scrubbed parent environment. */
  env: Record<string, string>
  /** Extra CLI arguments; provider-owned flags are rejected at start. */
  extraArgs: string[]
}

/** Config with every default applied. */
interface ResolvedConfig {
  readonly providerName: string
  readonly agentBinary: string
  readonly model?: string | undefined
  readonly outputFormat: OutputFormat
  readonly mode: ExecutionMode
  readonly sandbox: boolean
  readonly force: boolean
  readonly trust: boolean
  readonly timeoutMs: number
  readonly disposeGraceMs: number
  readonly stdoutMaxBytes: number
  readonly stdoutSpillMaxBytes: number
  readonly stderrMaxBytes: number
  readonly env: Record<string, string>
  readonly extraArgs: readonly string[]
}

/** Schema for the Profile bundle's provider row. */
export const Config = z.object({
  providerName: z.string().min(1).default(DEFAULT_PROVIDER_NAME),
  agentBinary: z.string().min(1).default(DEFAULT_AGENT_BINARY),
  model: z.string().min(1),
  outputFormat: z.union(['json', 'text']).default(DEFAULT_OUTPUT_FORMAT),
  mode: z.union(['agent', 'ask', 'plan']).default(DEFAULT_MODE),
  sandbox: z.boolean().default(true),
  force: z.boolean().default(false),
  trust: z.boolean().default(true),
  timeoutMs: z.number().default(DEFAULT_TIMEOUT_MS),
  disposeGraceMs: z.number().default(DEFAULT_DISPOSE_GRACE_MS),
  stdoutMaxBytes: z.number().default(DEFAULT_STDOUT_MAX_BYTES),
  stdoutSpillMaxBytes: z.number().default(DEFAULT_STDOUT_SPILL_MAX_BYTES),
  stderrMaxBytes: z.number().default(DEFAULT_STDERR_MAX_BYTES),
  env: z.dict(z.string()).default({}),
  extraArgs: z.array(z.string()).default([]),
})

/** Copy the schema-parsed config into the provider's read-only settings. */
function resolveConfig(config: Config): ResolvedConfig {
  return {
    providerName: config.providerName,
    agentBinary: config.agentBinary,
    ...(config.model === undefined ? {} : { model: config.model }),
    outputFormat: config.outputFormat,
    mode: config.mode,
    sandbox: config.sandbox,
    force: config.force,
    trust: config.trust,
    timeoutMs: config.timeoutMs,
    disposeGraceMs: config.disposeGraceMs,
    stdoutMaxBytes: config.stdoutMaxBytes,
    stdoutSpillMaxBytes: config.stdoutSpillMaxBytes,
    stderrMaxBytes: config.stderrMaxBytes,
    env: config.env,
    extraArgs: config.extraArgs,
  }
}

/**
 * Fail-loud timing-bound check: positive, finite, and schedulable. Values are
 * never clamped, because a clamp would hide a configuration mistake.
 * @param fieldName - config field name for the diagnostic.
 * @param value - the configured value.
 * @throws when the value is non-positive, non-finite, or above `MAX_TIMER_DELAY_MS`.
 */
function assertTimerBound(fieldName: string, value: number): void {
  assertPositiveFinite(PREFIX, fieldName, value)
  if (value > MAX_TIMER_DELAY_MS) {
    throw new Error(`${PREFIX}: ${fieldName} must be no greater than ${MAX_TIMER_DELAY_MS}`)
  }
}

/**
 * Fail-loud byte-budget check for one collection limit.
 * @param fieldName - config field name for the diagnostic.
 * @param value - the configured value.
 * @throws when the value is not a positive safe integer.
 */
function assertByteLimit(fieldName: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${PREFIX}: ${fieldName} must be a positive safe integer`)
  }
}

/** The route a Cursor run resolves to. */
export interface CursorRoute {
  readonly model?: string | undefined
}

/**
 * Merge the request's per-call route over the configured model.
 *
 * The Cursor CLI has no provider selector and no reasoning-effort or
 * max-token flags, so those requests are rejected rather than ignored. A
 * requested provider is accepted only when it names this provider instance,
 * which lets a deployment list `{ provider: 'cursor', model: 'auto' }` in the
 * Host's allowed-model routes without pretending the CLI understands it.
 * @param configured - the provider row's model, when set.
 * @param providerName - this instance's registry name.
 * @param requested - the start request's Agent options, when a caller selected one.
 * @returns the model this run uses.
 * @throws when a requested field cannot be honored.
 */
export function resolveCursorRoute(
  configured: { readonly model?: string | undefined },
  providerName: string,
  requested: AgentOptions | undefined,
): CursorRoute {
  if (requested?.provider !== undefined && requested.provider !== providerName) {
    throw new Error(
      `${PREFIX}: the Cursor CLI has no provider selector; provider "${requested.provider}" cannot be honored `
      + `(this instance is "${providerName}")`,
    )
  }
  if (requested?.reasoningEffort !== undefined) {
    throw new Error(`${PREFIX}: the Cursor CLI has no reasoning-effort flag, so a requested reasoningEffort cannot be honored`)
  }
  if (requested?.maxTokens !== undefined) {
    throw new Error(`${PREFIX}: the Cursor CLI has no max-tokens flag, so a requested agentOptions.maxTokens cannot be honored`)
  }
  return { model: requested?.model ?? configured.model }
}

/** One-shot Cursor CLI backend. */
/**
 * The Cursor child is a separate process, so parent-enforced start features
 * stay unsupported except the model, which maps onto `--model`.
 */
const CURSOR_START_CAPABILITIES: SubagentCapabilities = Object.freeze({
  ...NO_START_CAPABILITIES,
  agentOptions: true,
})

class CursorProvider implements SubagentProvider {
  readonly name: string
  readonly capabilities = CURSOR_START_CAPABILITIES
  readonly inheritsParentContext = false

  constructor(
    private readonly ctx: Context,
    private readonly config: ResolvedConfig,
  ) {
    this.name = config.providerName
  }

  /**
   * Resolve the executable, build the argv, and publish one run.
   *
   * Everything before publication — cwd validation, executable resolution,
   * task and `extraArgs` validation, and the spawn itself — rejects this call
   * and leaves no live resource behind. Everything after publication settles
   * through the returned run's `result`.
   * @param request - the resolved start request (absolute cwd, prompt, signal).
   * @returns the published run handle.
   */
  async start(request: ResolvedSubagentStartRequest): Promise<SubagentRun> {
    const config = this.config
    const cwd = assertUsableCwd(PREFIX, 'child cwd', request.cwd)
    const binary = await this.resolveBinary(config.agentBinary, request.signal)
    const task = flattenPrompt(request.prompt)
    const route = resolveCursorRoute(config, config.providerName, request.agentOptions)
    const argv = buildArgv(
      {
        outputFormat: config.outputFormat,
        sandbox: config.sandbox,
        trust: config.trust,
        force: config.force,
        mode: config.mode,
        model: route.model,
        extraArgs: config.extraArgs,
      },
      task,
      cwd,
    )
    if (request.signal.aborted) {
      throw new Error(`${PREFIX}: the request was aborted before the child process started`)
    }

    // One fused deadline: the parent's cancellation plus this run's timeout.
    // It drives the spawn signal, so the subprocess provider begins its
    // SIGTERM -> disposeGraceMs -> SIGKILL ladder even if nobody observes the
    // result first.
    const watch = deadline(request.signal, config.timeoutMs, TIMEOUT_CODE)
    const controller = new AbortController()
    const onAbort = (): void => {
      // Aborting an already-aborted controller is a no-op, so this is safe to
      // call after local cancellation won the race.
      controller.abort(watch.signal.reason)
    }
    watch.signal.addEventListener('abort', onAbort, { once: true })
    let watchCleared = false
    const clearWatch = (): void => {
      if (watchCleared) return
      watchCleared = true
      watch[Symbol.dispose]()
    }

    let child: SubprocessHandle
    try {
      child = this.ctx.subprocess.spawn(this.spawnSpec(binary, argv, cwd, controller.signal))
    } catch (error) {
      watch.signal.removeEventListener('abort', onAbort)
      clearWatch()
      throw error
    }

    this.ctx.logger.info(
      `${PREFIX} "${this.name}": starting child (cwd: ${cwd}; argv: ${[binary, ...argv.slice(0, -1)].join(' ')}; task bytes: ${Buffer.byteLength(task, 'utf8')})`,
    )

    const requestCancel = (): void => {
      if (!controller.signal.aborted) {
        controller.abort(new Error(`${PREFIX}: the run was cancelled locally`))
      }
    }
    let outcome: SubprocessOutcome | undefined
    let diagnostic: string | undefined
    const attempt = async (): Promise<SubagentResult> => {
      try {
        outcome = await child.done
      } catch (error) {
        diagnostic = formatDiagnostic({
          stage: 'run',
          category: 'process',
          message: `the child process could not be observed to completion (${errorName(error)})`,
        })
        throw error
      }
      const stdout = readCollectedStream(child.collected.stdout)
      const recovered = await recoverCollectedOutput(stdout, readUtf8File)
      const result = parseOutcome({
        outputFormat: config.outputFormat,
        exitCode: outcome.exitCode,
        signal: outcome.signal,
        stdout: recovered.text,
        stdoutComplete: recovered.complete,
      })
      if (result.diagnostic !== undefined) diagnostic = result.diagnostic
      return result
    }

    const result = settleRunResult({
      attempt,
      collectOutput: () => textOutput(readCollectedStream(child.collected.stdout).text),
      collectDiagnostic: () => diagnostic,
      cancelled: () => controller.signal.aborted,
      onError: (error, stopReason) => {
        this.ctx.logger.warn(
          `${PREFIX} "${this.name}": child run failed (stopReason: ${stopReason}): ${errorName(error)}`,
        )
      },
      signal: watch.signal,
      onAbort,
    })
      .finally(clearWatch)
      .then((settled) => {
        this.logSettlement(settled, outcome, child, cwd)
        const timeout = timeoutOf(watch.signal, TIMEOUT_CODE)
        if (settled.stopReason === 'aborted' && timeout !== undefined) {
          return {
            ...settled,
            diagnostic: formatDiagnostic({
              stage: 'run',
              category: 'timeout',
              message: `the child process did not finish within ${timeout.timeoutMs} ms`,
            }),
          }
        }
        return settled
      })

    return subprocessRunHandle({
      id: SessionId(randomUUID()),
      result,
      signal: watch.signal,
      onAbort,
      requestCancel,
      teardown: async () => {
        clearWatch()
        // `terminate` starts the provider-owned ladder (POSIX: SIGTERM, then
        // SIGKILL after the spec's graceMs); `waitForExit` awaits real
        // quiescence of the whole managed range.
        child.terminate()
        await child.waitForExit()
      },
    })
  }

  /** Build the fully explicit spawn spec for one run. */
  private spawnSpec(
    binary: string,
    argv: readonly string[],
    cwd: string,
    signal: AbortSignal,
  ): SubprocessSpawnSpec {
    const config = this.config
    return {
      argv: [binary, ...argv],
      cwd,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: config.stdoutMaxBytes, spill: { maxBytes: config.stdoutSpillMaxBytes } },
        stderr: { maxBytes: config.stderrMaxBytes },
      },
      graceMs: config.disposeGraceMs,
      signal,
      env: { ...scrubbedParentEnv(), ...config.env },
    }
  }

  /**
   * Resolve the configured CLI, mapping lookup failure to a startup rejection.
   *
   * The request signal is forwarded so a cancellation that lands while the
   * lookup is still in flight aborts it (the lookup can be remote), instead of
   * being noticed only after it returns.
   * @param binary - configured executable name or path.
   * @param signal - the start request's cancellation signal.
   * @returns the canonical executable path.
   */
  private async resolveBinary(binary: string, signal: AbortSignal): Promise<string> {
    try {
      return await this.ctx.subprocess.resolveExecutable(binary, undefined, signal)
    } catch (error) {
      throw new Error(`${PREFIX}: cannot resolve the Cursor CLI executable "${binary}"`, {
        cause: error,
      })
    }
  }

  /** Record the audit line for one settled run. */
  private logSettlement(
    settled: SubagentResult,
    outcome: SubprocessOutcome | undefined,
    child: SubprocessHandle,
    cwd: string,
  ): void {
    const fields = [
      `cwd: ${cwd}`,
      `exit code: ${outcome?.exitCode ?? 'none'}`,
      `signal: ${outcome?.signal ?? 'none'}`,
      `stopReason: ${settled.stopReason}`,
    ].join('; ')
    if (settled.stopReason === 'completed') {
      this.ctx.logger.info(`${PREFIX} "${this.name}": child finished (${fields})`)
      return
    }
    const stderr = truncateUtf8(
      maskSecrets(readCollectedStream(child.collected.stderr).text.trim()),
      LOG_STDERR_MAX_BYTES,
    )
    this.ctx.logger.warn(
      `${PREFIX} "${this.name}": child failed (${fields}${stderr.length === 0 ? '' : `; stderr tail: ${stderr}`})`,
    )
  }
}

/** Read one spill file as UTF-8 text. */
function readUtf8File(path: string): Promise<string> {
  return readFile(path, 'utf8')
}

/** Safe error name for a log line or a diagnostic message. */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown'
}

/**
 * Register one Profile-named Cursor provider.
 * @param ctx - context carrying the subagent and subprocess services.
 * @param config - registry name, CLI selection, argv policy, limits, and env.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  assertTimerBound('timeoutMs', resolved.timeoutMs)
  assertTimerBound('disposeGraceMs', resolved.disposeGraceMs)
  assertByteLimit('stdoutMaxBytes', resolved.stdoutMaxBytes)
  assertByteLimit('stdoutSpillMaxBytes', resolved.stdoutSpillMaxBytes)
  assertByteLimit('stderrMaxBytes', resolved.stderrMaxBytes)
  const provider = new CursorProvider(ctx, resolved)
  ctx.effect(() => ctx.subagents.registerProvider(provider))
}
