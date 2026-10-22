/**
 * Profile-named Pi coding agent CLI one-shot subagent provider.
 *
 * Every accepted run starts exactly one `pi --print --mode json` child in the
 * delegating Session's workspace, publishes it through the shared subagent
 * seam, and maps the JSONL event stream to a seam result. Failures before
 * publication reject `start()`; failures after publication settle as
 * `stopReason`.
 *
 * The child runs as a host process outside the DSH file sandbox (the CLI keeps
 * its own state under `$HOME`), so the provider's safety posture is: project
 * files are trusted only through the configured `approve` flag, credentials
 * are never placed in `env` by the provider, and the argv is fixed except for
 * the deployment-owned options listed in {@link Config}.
 *
 * @module @anago-harness/subagent-pi
 */
import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { assertPositiveFinite, NO_START_CAPABILITIES } from '@deepseek-ai/dsh-subagent'
import type {
  ResolvedSubagentStartRequest,
  SubagentCapabilities,
  SubagentProvider,
  SubagentRun,
} from '@deepseek-ai/dsh-subagent'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { PI_THINKING_LEVELS, assertToolList } from './args.ts'
import type { PiThinkingLevel } from './args.ts'
import { startPiRun } from './run.ts'
import type { PiRunSettings } from './run.ts'

/** Cordis plugin name. */
export const name = 'subagent-pi'

/** Services required before the provider can register. */
export const inject = ['subagents', 'subprocess']

/** Diagnostic prefix shared by every provider failure. */
const PREFIX = 'subagent-pi'

const DEFAULT_PROVIDER_NAME = 'pi'
const DEFAULT_EXECUTABLE = 'pi'
const DEFAULT_DISPOSE_GRACE_MS = 3_000

/**
 * Provider configuration (see the package README for the field table).
 *
 * The schema applies every default, so a value of this type is complete; a
 * `cordis.yml` row may omit any field.
 */
export interface Config {
  /** Registry name inside `ctx.subagents`; must be unique per composition. */
  providerName: string
  /** Pi CLI executable resolved through `ctx.subprocess.resolveExecutable`. */
  executable: string
  /** Optional `--provider` id; requires `model`. */
  provider?: string
  /** Optional `--model` pattern or id; absent uses Pi's own configured model. */
  model?: string
  /** Optional `--thinking` level. */
  thinking?: PiThinkingLevel
  /** Optional `--tools` allowlist; an empty list emits `--no-tools`. */
  tools?: string[] | undefined
  /** Optional `--exclude-tools` denylist. */
  excludeTools?: string[] | undefined
  /** Emit `--approve` (true) or `--no-approve` (false) for project-local files. */
  approve: boolean
  /** Optional absolute `--session-dir`; absent emits `--no-session`. */
  sessionDir?: string
  /** Extra environment variables layered over the scrubbed parent environment. */
  env: Record<string, string>
  /** Optional per-run wall-clock budget in milliseconds; absent is unbounded. */
  timeoutMs?: number
  /** SIGTERM-to-SIGKILL grace handed to the subprocess provider. */
  disposeGraceMs: number
}

/** Schema for the composing Profile's provider row. */
export const Config = z.object({
  providerName: z.string().min(1).default(DEFAULT_PROVIDER_NAME),
  executable: z.string().min(1).default(DEFAULT_EXECUTABLE),
  provider: z.string().min(1),
  model: z.string().min(1),
  thinking: z.union([...PI_THINKING_LEVELS]),
  tools: (z.array(z.string()) as z<string[] | undefined>).default(undefined),
  excludeTools: (z.array(z.string()) as z<string[] | undefined>).default(undefined),
  approve: z.boolean().default(true),
  sessionDir: z.string().min(1),
  env: z.dict(z.string()).default({}),
  timeoutMs: z.number(),
  disposeGraceMs: z.number().default(DEFAULT_DISPOSE_GRACE_MS),
})

/** Copy the schema-parsed config into the provider's read-only settings. */
function resolveConfig(config: Config): PiRunSettings {
  return {
    providerName: config.providerName,
    executable: config.executable,
    ...(config.provider === undefined ? {} : { provider: config.provider }),
    ...(config.model === undefined ? {} : { model: config.model }),
    ...(config.thinking === undefined ? {} : { thinking: config.thinking }),
    ...(config.tools === undefined ? {} : { tools: config.tools }),
    ...(config.excludeTools === undefined ? {} : { excludeTools: config.excludeTools }),
    approve: config.approve,
    ...(config.sessionDir === undefined ? {} : { sessionDir: config.sessionDir }),
    env: config.env,
    ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
    disposeGraceMs: config.disposeGraceMs,
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
 * The Pi child is a separate process, so parent-enforced start features stay
 * unsupported except the Agent route fields this provider maps onto Pi flags:
 * `provider`, `model`, and `reasoningEffort`.
 */
const PI_START_CAPABILITIES: SubagentCapabilities = Object.freeze({
  ...NO_START_CAPABILITIES,
  agentOptions: true,
})

/** One-shot Pi CLI backend. */
class PiProvider implements SubagentProvider {
  readonly name: string
  readonly capabilities = PI_START_CAPABILITIES
  readonly inheritsParentContext = false
  /** Present only when the row pins both halves of a complete Pi route. */
  readonly agentRouteDefaults?: Readonly<{ provider: string; model: string }>

  constructor(
    private readonly ctx: Context,
    private readonly settings: PiRunSettings,
  ) {
    this.name = settings.providerName
    if (settings.provider !== undefined && settings.model !== undefined) {
      this.agentRouteDefaults = Object.freeze({ provider: settings.provider, model: settings.model })
    }
  }

  /**
   * Validate the request, resolve the CLI, and publish one run.
   * @param request - the resolved start request (absolute cwd, prompt, signal).
   * @returns the published run handle.
   */
  start(request: ResolvedSubagentStartRequest): Promise<SubagentRun> {
    return startPiRun(this.ctx, this.settings, request)
  }
}

/**
 * Register one Profile-named Pi provider.
 * @param ctx - context carrying the subagent and subprocess services.
 * @param config - registry name, CLI selection, argv policy, session policy, and env.
 */
export function apply(ctx: Context, config: Config): void {
  const settings = resolveConfig(config)
  assertTimerBound('disposeGraceMs', settings.disposeGraceMs)
  if (settings.timeoutMs !== undefined) assertTimerBound('timeoutMs', settings.timeoutMs)
  if (settings.provider !== undefined && settings.model === undefined) {
    throw new Error(`${PREFIX}: provider requires model (the Pi CLI uses --provider only to search for --model)`)
  }
  if (settings.sessionDir !== undefined && !isAbsolute(settings.sessionDir)) {
    throw new Error(`${PREFIX}: sessionDir must be an absolute path: ${settings.sessionDir}`)
  }
  if (settings.tools !== undefined) assertToolList('tools', settings.tools)
  if (settings.excludeTools !== undefined) assertToolList('excludeTools', settings.excludeTools)
  const provider = new PiProvider(ctx, settings)
  ctx.effect(() => ctx.subagents.registerProvider(provider))
}
