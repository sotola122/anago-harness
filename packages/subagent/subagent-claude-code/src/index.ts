/**
 * Profile-named Claude Code one-shot subagent provider. Every accepted run
 * invokes the official Agent SDK in the delegating Session's workspace and
 * places the SDK-spawned real CLI under the shared subprocess owner.
 *
 * @module @deepseek-ai/dsh-subagent-claude-code
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import {
  assertPositiveFinite,
  NO_START_CAPABILITIES,
  assertUsableCwd,
  type ResolvedSubagentStartRequest,
  type SubagentCapabilities,
  type SubagentProvider,
} from '@deepseek-ai/dsh-subagent'
import {
  CLAUDE_CODE_PERMISSION_MODES,
  DEFAULT_CLAUDE_CODE_PERMISSION_MODE,
  DEFAULT_DISPOSE_GRACE_MS,
  claudeCodeStartupFailure,
  startClaudeCodeRun,
  type ClaudeCodePermissionMode,
  type ClaudeCodeRunSpec,
} from './run.ts'

export const name = 'subagent-claude-code'
export const inject = ['subagents', 'subprocess']

const DEFAULT_PROVIDER_NAME = 'claude-code'

/* jscpd:ignore-start -- sibling product providers intentionally expose
 * overlapping deployment-owned fields without adding a shared config owner. */
/** Deployment-owned model, permission, environment, and process-release settings. */
export interface Config {
  /** Provider name on `ctx.subagents` (default `claude-code`). */
  providerName?: string
  /** Native Claude model fixed for this instance; omitted to inherit Claude settings. */
  model?: string
  /**
   * Explicit environment entries layered over the subprocess seam's
   * credential-scrubbed parent environment.
   */
  env?: Record<string, string>
  /**
   * Native non-interactive mode fixed for this Provider instance. Defaults to
   * `dontAsk`; `acceptEdits` accepts edits, `auto` uses the native classifier,
   * `plan` returns a plan without approving execution, and
   * `bypassPermissions` explicitly skips permission checks.
   */
  permissionMode?: ClaudeCodePermissionMode
  /**
   * Modes a delegating call may select through `permission_mode`. Defaults to
   * `[permissionMode]`, which leaves the tool without that argument. Must
   * include `permissionMode` and be non-empty.
   */
  allowedPermissionModes?: ClaudeCodePermissionMode[] | undefined
  /**
   * Upper bound in milliseconds for one run; an overrun ends the run as an
   * error. Omitted means unbounded: only cancellation stops a run.
   */
  timeoutMs?: number | undefined
  /** Grace in milliseconds between Claude Code managed-range termination tiers. */
  disposeGraceMs?: number
}

export const Config: z<Config> = z.object({
  providerName: z.string().min(1).default(DEFAULT_PROVIDER_NAME),
  model: z.string().min(1),
  env: z.dict(z.string()).default({}),
  permissionMode: z.union([...CLAUDE_CODE_PERMISSION_MODES])
    .default(DEFAULT_CLAUDE_CODE_PERMISSION_MODE),
  // Absent is distinct from `[]`, which `apply` rejects.
  allowedPermissionModes: (z.array(z.union([...CLAUDE_CODE_PERMISSION_MODES])) as z<ClaudeCodePermissionMode[] | undefined>)
    .default(undefined),
  timeoutMs: (z.number() as z<number | undefined>).default(undefined),
  disposeGraceMs: z.number().default(DEFAULT_DISPOSE_GRACE_MS),
})

type ResolvedConfig = Omit<Required<Config>, 'model' | 'timeoutMs' | 'allowedPermissionModes'>
  & Pick<Config, 'model' | 'timeoutMs'>
  & { allowedPermissionModes: ClaudeCodePermissionMode[] }
/* jscpd:ignore-end */

/* jscpd:ignore-start -- Cordis registration and shared-seam plumbing mirror
 * the Codex sibling; each product's lifecycle remains package-private. */
class ClaudeCodeProvider implements SubagentProvider {
  readonly capabilities: SubagentCapabilities = NO_START_CAPABILITIES
  readonly inheritsParentContext = false
  readonly permissionModes: readonly ClaudeCodePermissionMode[]
  readonly defaultPermissionMode: ClaudeCodePermissionMode

  constructor(
    readonly name: string,
    private readonly ctx: Context,
    private readonly config: ResolvedConfig,
  ) {
    this.permissionModes = config.allowedPermissionModes
    this.defaultPermissionMode = config.permissionMode
  }

  async start(request: ResolvedSubagentStartRequest) {
    let cwd: string
    try {
      cwd = assertUsableCwd('subagent-claude-code', 'child cwd', request.cwd)
    } catch (error: unknown) {
      if (request.signal.aborted) {
        throw new Error(
          'subagent-claude-code: request was aborted before SDK startup',
        )
      }
      const failure = claudeCodeStartupFailure(error)
      this.ctx.logger.warn(
        `subagent-claude-code "${this.name}": child start failed: %o`,
        failure,
      )
      throw failure
    }
    const spec: ClaudeCodeRunSpec = {
      cwd,
      ...this.config.model === undefined ? {} : { model: this.config.model },
      // The service already rejected modes outside `permissionModes`.
      permissionMode: request.permissionMode === undefined
        ? this.config.permissionMode
        : request.permissionMode as ClaudeCodePermissionMode,
      ...this.config.timeoutMs === undefined ? {} : { timeoutMs: this.config.timeoutMs },
      env: this.config.env,
      disposeGraceMs: this.config.disposeGraceMs,
      spawn: spawnSpec => this.ctx.subprocess.spawn(spawnSpec),
      onError: (error, stopReason) => {
        this.ctx.logger.warn(
          `subagent-claude-code "${this.name}": child run failed (${stopReason}): %o`,
          error,
        )
      },
    }
    return startClaudeCodeRun(request, spec)
  }
}

/**
 * Register one Profile-named Claude Code provider.
 * @param ctx - context carrying shared subagent and subprocess services.
 * @param config - registry name, optional model, permission mode, child environment, and disposal grace.
 */
export function apply(ctx: Context, config: Config): void {
  const permissionMode = config.permissionMode ?? DEFAULT_CLAUDE_CODE_PERMISSION_MODE
  const allowedPermissionModes = config.allowedPermissionModes ?? [permissionMode]
  if (allowedPermissionModes.length === 0) {
    throw new Error('subagent-claude-code: allowedPermissionModes must not be empty')
  }
  if (!allowedPermissionModes.includes(permissionMode)) {
    throw new Error(
      `subagent-claude-code: allowedPermissionModes must include permissionMode "${permissionMode}"`,
    )
  }
  const resolved: ResolvedConfig = {
    providerName: config.providerName ?? DEFAULT_PROVIDER_NAME,
    ...config.model === undefined ? {} : { model: config.model },
    env: config.env as Record<string, string>,
    permissionMode,
    allowedPermissionModes,
    ...config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs },
    disposeGraceMs: config.disposeGraceMs as number,
  }
  if (resolved.timeoutMs !== undefined) {
    assertPositiveFinite('subagent-claude-code', 'timeoutMs', resolved.timeoutMs)
    if (resolved.timeoutMs > MAX_TIMER_DELAY_MS) {
      throw new Error(
        `subagent-claude-code: timeoutMs must be no greater than ${MAX_TIMER_DELAY_MS}`,
      )
    }
  }
  assertPositiveFinite(
    'subagent-claude-code',
    'disposeGraceMs',
    resolved.disposeGraceMs,
  )
  if (resolved.disposeGraceMs > MAX_TIMER_DELAY_MS) {
    throw new Error(
      `subagent-claude-code: disposeGraceMs must be no greater than ${MAX_TIMER_DELAY_MS}`,
    )
  }
  ctx.subagents.registerProvider(new ClaudeCodeProvider(
    resolved.providerName,
    ctx,
    resolved,
  ))
}
/* jscpd:ignore-end */
