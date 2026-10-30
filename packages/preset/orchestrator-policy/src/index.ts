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

/** Fixed remainder of the depth-0 section: reuse, inspection, external CLIs, and create_goal. */
const DELEGATION_TAIL = `Before a follow-up delegation, call list_agents and continue a matching child with send_message when the new task has the same purpose and files, its recorded provider, model, and reasoning effort still match the purpose route, and the earlier work was short or mechanical. Set description to the purpose; list_agents keeps that label after compaction removes the tool result. Otherwise start a new child: long or exploratory work whose transcript would cost more than a fresh child's first request, the task must not see earlier context, category review (one call fans out one child per route), tasks that must run in parallel, started together, or no child matching the route. One child is one conversation and cannot run two tasks at once. It keeps the route, working directory, and history it started with. A follow-up reply arrives as a completion notice, not a synchronous answer. One todo item is one delegation, and a follow-up on that todo continues the child that delegation started.

Inspect with read, glob, grep, and the shell. Run tests and git queries yourself. Edit a file yourself only to land a result a child already returned.

Start claude, cursor, cursor-agent, and codex only inside a delegated child. Call the subagent tool, put the exact command in the child prompt, and tell the child to return the output. Wait for the completion notice. A shell error that tells you to delegate means call subagent; do not hide the same command in a script or an interpreter.

create_goal continues this same session, so it does not replace a delegation.`

/**
 * Fixed denial returned to the model. It does not echo the command.
 */
export const DENIAL_MESSAGE = 'Do not start an external agent CLI in this session. Delegate with the subagent tool and tell the child the exact command. The child runs it and returns the output. Do not hide that command in a script or an interpreter.'

/** Initial basename denylist. Adding a name is a config change; the prompt text stays fixed. */
export const DEFAULT_BINARIES = ['claude', 'cursor', 'cursor-agent', 'codex'] as const

/** Skill loaded before a child prompt is composed, when `promptSkills` is omitted. */
const DEFAULT_PROMPT_SKILLS = ['writing-for-agents'] as const

/** Skill an implementation child loads before it changes code, when `childSkills` is omitted. */
const DEFAULT_CHILD_SKILLS = ['ponytail'] as const

/** Plugin config: basename denylist and skill names in the depth-0 section. */
export interface Config {
  /**
   * Command basenames denied at depth 0. Path prefixes are ignored. Empty
   * denies nothing. A name containing `/` or `\` fails at load because it
   * can never match a basename. Omitted config receives the initial four names.
   */
  binaries: string[]
  /**
   * Skills the depth-0 orchestrator loads with the `skill` tool before it
   * composes a child prompt. Omitted config receives `writing-for-agents`.
   * An empty array omits that sentence. An empty or whitespace-only name
   * fails at load.
   */
  promptSkills: string[]
  /**
   * Skills named in every implementation child prompt. The orchestrator tells
   * the child to load each with the `skill` tool before the child changes
   * code. Omitted config receives `ponytail`. An empty array omits that
   * sentence. An empty or whitespace-only name fails at load.
   */
  childSkills: string[]
}

/** Runtime schema for the denylist and the skill lists. */
export const Config: z<Config> = z.object({
  binaries: z.array(z.string()).default([...DEFAULT_BINARIES]),
  promptSkills: z.array(z.string()).default([...DEFAULT_PROMPT_SKILLS]),
  childSkills: z.array(z.string()).default([...DEFAULT_CHILD_SKILLS]),
})

/** Plugin config before schema defaults. Fields may be omitted. */
interface ConfigInput {
  binaries?: readonly string[]
  promptSkills?: readonly string[]
  childSkills?: readonly string[]
}

/**
 * Resolve the denylist and skill lists, applying defaults and rejecting unusable names.
 * @param config - raw plugin config, before or after schema defaults.
 * @returns the basename denylist and the skill lists used by the guard and the section.
 * @throws if a binary name is empty or contains a path separator, or if a skill name is empty or whitespace-only.
 */
export function resolveConfig(config: ConfigInput): {
  binaries: readonly string[]
  promptSkills: readonly string[]
  childSkills: readonly string[]
} {
  const binaries = config.binaries ?? [...DEFAULT_BINARIES]
  for (const binary of binaries) {
    if (binary.length === 0 || binary.includes('/') || binary.includes('\\')) {
      throw new Error(`orchestrator-policy: binaries entries must be non-empty basenames, got ${JSON.stringify(binary)}`)
    }
  }
  return {
    binaries,
    promptSkills: skillNames('promptSkills', config.promptSkills, DEFAULT_PROMPT_SKILLS),
    childSkills: skillNames('childSkills', config.childSkills, DEFAULT_CHILD_SKILLS),
  }
}

/**
 * Render the depth-0 delegation section.
 * An empty `promptSkills` or `childSkills` omits that sentence.
 * @param config - skill lists. Omitted fields use the load defaults.
 * @returns the section text shown at depth 0.
 * @throws if a skill name is empty or whitespace-only, or if a binary name cannot match.
 */
export function orchestratorSection(config: ConfigInput = {}): string {
  const { promptSkills, childSkills } = resolveConfig(config)
  return `${delegationLead(promptSkills, childSkills)}\n\n${DELEGATION_TAIL}`
}

/**
 * Default depth-0 delegation section, from {@link orchestratorSection} with omitted skill lists.
 * Empty at depth 1 and above, so render drops the section.
 */
export const ORCHESTRATOR_SECTION = orchestratorSection()

/**
 * Register the depth-0 persona, the delegation contract, and the shell guard.
 * @param ctx - preset scope. An unscoped context is rejected.
 * @param config - basename denylist and skill lists.
 * @throws if `ctx` has no scope, if `config.binaries` contains a path, or if a skill name is empty or whitespace-only.
 */
export function apply(ctx: Context, config: Config): void {
  if (scopeOf(ctx) === undefined) {
    throw new Error('orchestrator-policy requires a preset scope; a global mount would deny external agent CLIs for every agent')
  }
  const resolved = resolveConfig(config)
  const binaries = new Set(resolved.binaries)
  const section = orchestratorSection(resolved)
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
      ? section
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

/**
 * Accept a skill list, or the omitted-field default. An empty array is kept.
 * @param field - config field named in the load error.
 * @param names - configured names, or undefined when the field was omitted.
 * @param fallback - names used when the field was omitted.
 * @returns the names written into the delegation section.
 * @throws if a name is empty or whitespace-only.
 */
function skillNames(
  field: 'promptSkills' | 'childSkills',
  names: readonly string[] | undefined,
  fallback: readonly string[],
): readonly string[] {
  const list = names ?? [...fallback]
  for (const name of list) {
    if (name.trim().length === 0) {
      throw new Error(`orchestrator-policy: ${field} entries must be non-empty skill names, got ${JSON.stringify(name)}`)
    }
  }
  return list
}

/** Opening paragraph, including a skill sentence only when that list is non-empty. */
function delegationLead(promptSkills: readonly string[], childSkills: readonly string[]): string {
  const sentences = [
    'Split a request into tasks and delegate each task with the subagent tool.',
    'When that tool lists category, set it; otherwise omit it.',
  ]
  if (promptSkills.length > 0) {
    const follow = promptSkills.length === 1 ? 'it' : 'each'
    sentences.push(`Before composing a child prompt, load ${listed(promptSkills)} with the skill tool and follow ${follow}.`)
  }
  if (childSkills.length > 0) {
    sentences.push(`In every implementation child prompt, tell the child to load ${listed(childSkills)} with the skill tool before it changes code.`)
  }
  return sentences.join(' ')
}

/** Join skill names for one sentence. A single name is returned unchanged. */
function listed(names: readonly string[]): string {
  if (names.length < 2) return names.join(', ')
  const last = names[names.length - 1] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${last}`
}
