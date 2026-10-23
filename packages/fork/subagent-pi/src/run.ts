/**
 * One-shot Pi child lifecycle: validate the child cwd and prompt, resolve the
 * CLI, spawn it through the subprocess seam, map the JSONL event stream to a
 * seam result, and tear the managed process range down to quiescence.
 *
 * Everything before publication rejects `start()` and leaves no live resource
 * behind. Everything after publication settles through the returned run's
 * `result`, which never rejects.
 *
 * @module @anago-harness/subagent-pi/run
 */
import { randomUUID } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { Context } from '@deepseek-ai/cordis'
import type { AgentOptions } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import {
  assertUsableCwd,
  settleRunResult,
  subprocessRunHandle,
} from '@deepseek-ai/dsh-subagent'
import type {
  ResolvedSubagentStartRequest,
  SubagentResult,
  SubagentRun,
} from '@deepseek-ai/dsh-subagent'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import type { SubprocessHandle, SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'
import { buildArgv, flattenPrompt, PI_THINKING_LEVELS } from './args.ts'
import type { PiArgvOptions, PiThinkingLevel } from './args.ts'
import { failureDiagnostic, maskSecrets, truncateUtf8 } from './diagnostic.ts'
import { PiJsonlStream } from './parse.ts'

/** Diagnostic prefix shared by every provider failure. */
const PREFIX = 'subagent-pi'

/** Timeout code carried by the fused per-run deadline. */
const TIMEOUT_CODE = 'SUBAGENT_PI_TIMEOUT'

/** Byte cap for stderr kept in memory only for the harness log tail. */
const STDERR_MAX_BYTES = 65_536

/** Byte budget for the stderr tail quoted into the harness log line. */
const LOG_STDERR_MAX_BYTES = 512

/** A subprocess runtime that may omit executable lookup (structural binding). */
interface ExecutableLookup {
  resolveExecutable?: (
    command: string,
    env?: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ) => Promise<string>
}

/** Provider settings needed to build and supervise one run. */
export interface PiRunSettings extends PiArgvOptions {
  /** Registry name used in log lines. */
  readonly providerName: string
  /** Configured Pi CLI executable name or absolute path. */
  readonly executable: string
  /** Extra environment variables layered over the scrubbed parent environment. */
  readonly env: Record<string, string>
  /** Per-run wall-clock budget; absent leaves only parent cancellation as a bound. */
  readonly timeoutMs?: number | undefined
  /** SIGTERM-to-SIGKILL grace handed to the subprocess provider. */
  readonly disposeGraceMs: number
}

/** Safe error name for a log line or a diagnostic message. */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown'
}

/**
 * Resolve the configured CLI, mapping lookup failure to one actionable startup
 * error. A runtime that exposes no executable lookup keeps the configured name,
 * which the spawn then resolves from `PATH`.
 * @param ctx - context carrying the subprocess service.
 * @param executable - configured executable name or path.
 * @param signal - the start request's cancellation signal.
 * @returns the canonical executable path.
 * @throws when the lookup runs and cannot find the executable.
 */
async function resolveExecutable(
  ctx: Context,
  executable: string,
  signal: AbortSignal,
): Promise<string> {
  const lookup: ExecutableLookup = ctx.subprocess
  if (lookup.resolveExecutable === undefined) return executable
  try {
    return await lookup.resolveExecutable(executable, undefined, signal)
  } catch (error) {
    throw new Error(
      `${PREFIX}: cannot find the Pi CLI executable "${executable}"; install it with "curl -fsSL https://pi.dev/install.sh | sh" (a per-user install under ~/.pi) or set "executable" to its absolute path`,
      { cause: error },
    )
  }
}

/** The route this run resolves to: provider, model, and thinking level. */
export interface PiResolvedRoute {
  readonly provider?: string | undefined
  readonly model?: string | undefined
  readonly thinking?: PiThinkingLevel | undefined
}

/**
 * Merge the request's per-call route over the provider's configured route.
 *
 * The seam's `agentOptions` may also carry `maxTokens`, which the Pi CLI has no
 * flag for; accepting it silently would lie about the request, so it is
 * rejected. A `reasoningEffort` outside Pi's own vocabulary is rejected for the
 * same reason.
 * @param settings - provider-owned route defaults.
 * @param requested - the start request's Agent options, when a caller selected one.
 * @returns the route this run uses.
 * @throws when a requested field cannot be honored, or a provider has no model.
 */
export function resolvePiRoute(
  settings: PiRunSettings,
  requested: AgentOptions | undefined,
): PiResolvedRoute {
  if (requested?.maxTokens !== undefined) {
    throw new Error(
      `${PREFIX}: the Pi CLI has no max-tokens flag, so a requested agentOptions.maxTokens cannot be honored; `
      + 'set the cap through the Pi model configuration instead',
    )
  }
  const provider = requested?.provider ?? settings.provider
  const model = requested?.model ?? settings.model
  if (provider !== undefined && model === undefined) {
    throw new Error(
      `${PREFIX}: provider "${provider}" was requested without a model; the Pi CLI uses --provider only to search for --model`,
    )
  }
  let thinking = settings.thinking
  if (requested?.reasoningEffort !== undefined) {
    const effort = requested.reasoningEffort as string
    if (!(PI_THINKING_LEVELS as readonly string[]).includes(effort)) {
      throw new Error(
        `${PREFIX}: reasoning effort "${effort}" is not a Pi thinking level; use one of ${PI_THINKING_LEVELS.join(', ')}`,
      )
    }
    thinking = effort as PiThinkingLevel
  }
  return { provider, model, thinking }
}

/**
 * Start one Pi CLI child and publish its run handle.
 * @param ctx - context carrying the subagent and subprocess services.
 * @param settings - resolved provider settings.
 * @param request - the resolved start request (absolute cwd, prompt, signal).
 * @returns the published run handle.
 * @throws when the cwd, prompt, executable, or spawn is unusable; no resource
 * survives the rejection.
 */
export async function startPiRun(
  ctx: Context,
  settings: PiRunSettings,
  request: ResolvedSubagentStartRequest,
): Promise<SubagentRun> {
  const cwd = assertUsableCwd(PREFIX, 'child cwd', request.cwd)
  const task = flattenPrompt(request.prompt)
  const executable = await resolveExecutable(ctx, settings.executable, request.signal)
  const route = resolvePiRoute(settings, request.agentOptions)
  const argv = buildArgv({ ...settings, ...route }, task)
  if (request.signal.aborted) {
    throw new Error(`${PREFIX}: the request was aborted before the child process started`)
  }

  // One fused deadline: parent cancellation plus this run's optional timeout.
  // A local cancel joins it, and the fused signal drives the spawn directly, so
  // the subprocess provider starts its SIGTERM -> disposeGraceMs -> SIGKILL
  // ladder without a separate observer.
  const watch = deadline(request.signal, settings.timeoutMs ?? 0, TIMEOUT_CODE)
  const localCancel = new AbortController()
  const runSignal = AbortSignal.any([watch.signal, localCancel.signal])
  let watchCleared = false
  const clearWatch = (): void => {
    if (watchCleared) return
    watchCleared = true
    watch[Symbol.dispose]()
  }
  // The fused signal carries cancellation state; aborting it only needs to
  // release the now-unused deadline timer.
  const onAbort = (): void => { clearWatch() }
  runSignal.addEventListener('abort', onAbort, { once: true })

  let child: SubprocessHandle
  try {
    child = ctx.subprocess.spawn({
      argv: [executable, ...argv],
      cwd,
      stdio: {
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: { maxBytes: STDERR_MAX_BYTES },
      },
      graceMs: settings.disposeGraceMs,
      signal: runSignal,
      env: { ...scrubbedParentEnv(), ...settings.env },
    })
  } catch (error) {
    runSignal.removeEventListener('abort', onAbort)
    clearWatch()
    throw error
  }

  const stream = new PiJsonlStream()
  const stdout = child.stdout
  if (stdout === undefined) {
    runSignal.removeEventListener('abort', onAbort)
    clearWatch()
    child.terminate()
    await child.waitForExit()
    throw new Error(`${PREFIX}: the subprocess provider did not expose the child's stdout stream`)
  }
  stdout.setEncoding('utf8')
  const onData = (chunk: string): void => { stream.push(chunk) }
  const onEnd = (): void => { stream.end() }
  stdout.on('data', onData)
  stdout.on('end', onEnd)
  const detachStdout = (): void => {
    stdout.off('data', onData)
    stdout.off('end', onEnd)
  }

  ctx.logger.info(
    `${PREFIX} "${settings.providerName}": starting child (cwd: ${cwd}; argv: ${[executable, ...argv.slice(0, -1)].join(' ')}; task bytes: ${Buffer.byteLength(task, 'utf8')})`,
  )

  const requestCancel = (): void => {
    localCancel.abort(new Error(`${PREFIX}: the run was cancelled locally`))
  }
  let outcome: SubprocessOutcome | undefined
  let diagnostic: string | undefined
  const observeProcess = async (): Promise<SubprocessOutcome> => {
    try {
      return await child.done
    } catch (error) {
      diagnostic = failureDiagnostic({
        stage: 'run',
        category: 'process',
        message: `the child process could not be observed to completion (${errorName(error)})`,
      })
      throw error
    }
  }
  const stderrTail = (): string => {
    const reader = child.collected.stderr
    return reader === undefined ? '' : reader.readFrom(0).text.trim()
  }
  const attempt = async (): Promise<SubagentResult> => {
    outcome = await observeProcess()
    stream.end()
    const result = stream.outcome({ ...outcome, stderr: stderrTail() })
    if (result.diagnostic !== undefined) diagnostic = result.diagnostic
    return result
  }
  const logSettlement = (settled: SubagentResult): void => {
    const fields = [
      `cwd: ${cwd}`,
      `exit code: ${outcome?.exitCode ?? 'none'}`,
      `signal: ${outcome?.signal ?? 'none'}`,
      `stopReason: ${settled.stopReason}`,
    ].join('; ')
    if (settled.stopReason === 'completed') {
      ctx.logger.info(`${PREFIX} "${settings.providerName}": child finished (${fields})`)
      return
    }
    const stderr = truncateUtf8(maskSecrets(stderrTail()), LOG_STDERR_MAX_BYTES)
    ctx.logger.warn(
      `${PREFIX} "${settings.providerName}": child failed (${fields}${stderr.length === 0 ? '' : `; stderr tail: ${stderr}`})`,
    )
  }

  const result = settleRunResult({
    attempt,
    collectOutput: (): readonly ContentBlock[] => stream.output(),
    collectDiagnostic: () => diagnostic,
    cancelled: () => runSignal.aborted,
    onError: (error, stopReason) => {
      ctx.logger.warn(
        `${PREFIX} "${settings.providerName}": child run failed (stopReason: ${stopReason}): ${errorName(error)}`,
      )
    },
    signal: runSignal,
    onAbort,
  })
    .finally(clearWatch)
    .then((settled) => {
      logSettlement(settled)
      const timeout = timeoutOf(watch.signal, TIMEOUT_CODE)
      return settled.stopReason === 'aborted' && timeout !== undefined
        ? {
          ...settled,
          diagnostic: failureDiagnostic({
            stage: 'run',
            category: 'timeout',
            message: `the child process did not finish within ${timeout.timeoutMs} ms`,
          }),
        }
        : settled
    })

  return subprocessRunHandle({
    id: brandString<SubagentRun['id']>(randomUUID()),
    result,
    signal: runSignal,
    onAbort,
    requestCancel,
    teardown: async () => {
      clearWatch()
      // `terminate` starts the provider-owned ladder; `waitForExit` awaits real
      // quiescence of the whole managed range, including surviving children.
      child.terminate()
      try {
        await child.waitForExit()
        await child.done.catch(() => {})
      } finally {
        detachStdout()
      }
    },
  })
}
