/**
 * Preset-scoped orchestrator policy: a depth-0 delegation contract and a
 * guard that denies direct external-agent CLI starts.
 *
 * Mount it only inside an agent preset. An unscoped mount would deny those
 * starts for every agent, including a `standard` worker. Fork and workflow
 * children join this preset generation, so the persona and the contract
 * branch on delegation depth rather than on a static persona row.
 *
 * @module @deepseek-ai/dsh-orchestrator-policy
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { delegationDepthOf } from '@deepseek-ai/dsh-subagent'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import { PERSONA_PREFIX_SECTION } from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { ToolGuard } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-tools'
import { commandInvokesBinary } from './command.ts'

/** Cordis plugin name. */
export const name = 'orchestrator-policy'

/** Prompt registry and tool registry this row contributes to. */
export const inject = ['systemPrompt', 'tools']

/** Prompt-section name for the depth-0 delegation contract. */
export const ORCHESTRATOR_POLICY_SECTION = 'orchestrator:policy'

/**
 * Depth-0 persona. Depth 1 and above use {@link STANDARD_PERSONA}.
 */
export const ORCHESTRATOR_PERSONA = 'You are the orchestrator for this session. Split work and delegate it; keep your tools for inspection and for landing a child\'s result.'

/** Persona used when this preset generation is not the depth-0 parent. */
export const STANDARD_PERSONA = 'You are a coding agent powered by the {{model}} model.'

/**
 * Depth-0 delegation contract. Empty at depth 1 and above, so render drops it.
 */
export const ORCHESTRATOR_SECTION = `Split a request into tasks and delegate each task with the subagent tool. When that tool lists category, set it; otherwise omit it.

Inspect with read, glob, grep, and the shell. Run tests and git queries yourself. Edit a file yourself only to land a result a child already returned.

Start claude, cursor, cursor-agent, and codex only inside a delegated child. Call the subagent tool, put the exact command in the child prompt, and tell the child to return the output. Wait for the completion notice. A shell error that tells you to delegate means call subagent; do not hide the same command in a script or an interpreter.

One todo item is one delegation. create_goal continues this same session, so it does not replace a delegation.`

/**
 * Fixed denial returned to the model. It does not echo the command.
 */
export const DENIAL_MESSAGE = 'Do not start an external agent CLI in this session. Delegate with the subagent tool and tell the child the exact command. The child runs it and returns the output. Do not hide that command in a script or an interpreter.'

/** Initial basename denylist. Adding a name is a config change; the prompt text stays fixed. */
export const DEFAULT_BINARIES = ['claude', 'cursor', 'cursor-agent', 'codex'] as const

/** Plugin config: basename denylist for direct shell starts. */
export interface Config {
  /**
   * Command basenames denied at depth 0. Path prefixes are ignored. Empty
   * denies nothing. A name containing `/` or `\` fails at load because it
   * can never match a basename. Omitted config receives the initial four names.
   */
  binaries: string[]
}

/** Runtime schema for the denylist. */
export const Config: z<Config> = z.object({
  binaries: z.array(z.string()).default([...DEFAULT_BINARIES]),
})

/**
 * Resolve the denylist, applying the default and rejecting names that cannot match.
 * @param config - raw plugin config, before or after schema defaults.
 * @returns the basename denylist used by the guard.
 * @throws if a name is empty or contains a path separator.
 */
export function resolveConfig(config: { binaries?: readonly string[] }): { binaries: readonly string[] } {
  const binaries = config.binaries ?? [...DEFAULT_BINARIES]
  for (const binary of binaries) {
    if (binary.length === 0 || binary.includes('/') || binary.includes('\\')) {
      throw new Error(`orchestrator-policy: binaries entries must be non-empty basenames, got ${JSON.stringify(binary)}`)
    }
  }
  return { binaries }
}

/**
 * Register the depth-0 persona, the delegation contract, and the shell guard.
 * @param ctx - preset scope. An unscoped context is rejected.
 * @param config - basename denylist.
 * @throws if `ctx` has no scope, or if `config.binaries` contains a path.
 */
export function apply(ctx: Context, config: Config): void {
  if (scopeOf(ctx) === undefined) {
    throw new Error('orchestrator-policy requires a preset scope; a global mount would deny external agent CLIs for every agent')
  }
  const binaries = new Set(resolveConfig(config).binaries)
  ctx.effect(() => ctx.systemPrompt.section({
    name: PERSONA_PREFIX_SECTION,
    order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'),
    text: context => context.agent !== undefined && delegationDepthOf(context.agent) === 0
      ? ORCHESTRATOR_PERSONA
      : STANDARD_PERSONA,
  }), 'orchestrator-policy.persona()')
  ctx.effect(() => ctx.systemPrompt.section({
    name: ORCHESTRATOR_POLICY_SECTION,
    order: ctx.systemPrompt.getSectionOrder('ORCHESTRATOR_POLICY'),
    text: context => context.agent !== undefined && delegationDepthOf(context.agent) === 0
      ? ORCHESTRATOR_SECTION
      : '',
  }), 'orchestrator-policy.section()')
  const guard: ToolGuard = (exec) => {
    if (exec.name !== 'bash' && exec.name !== 'pwsh') return undefined
    if (exec.agent === undefined || delegationDepthOf(exec.agent) !== 0) return undefined
    const command = commandOf(exec.arguments)
    if (command === undefined) return undefined
    return commandInvokesBinary(command, binaries) ? DENIAL_MESSAGE : undefined
  }
  ctx.effect(() => ctx.tools.guard(guard), 'orchestrator-policy.guard()')
}

/**
 * Read the shell `command` argument from model/tool JSON.
 * @param args - parsed tool arguments.
 * @returns the command string, or undefined when the call is not a shell command.
 */
function commandOf(args: unknown): string | undefined {
  if (typeof args !== 'object' || args === null || !('command' in args)) return undefined
  return typeof args.command === 'string' ? args.command : undefined
}
