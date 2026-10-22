/**
 * One fixed Japanese-response instruction, injected as a global system-prompt
 * section.
 *
 * The section is static text, registered with `interpolate: false`, at the last
 * system-prompt position, after the deployment persona suffix. It reaches the
 * main agents of the standard, ptc, and cordis presets only:
 *
 * - a subagent child (`session.header.delegationDepth > 0`) gets `''`, so the
 *   empty section is dropped by rendering and agent↔subagent traffic stays in
 *   English;
 * - an assembly without `agent` (diagnostics, plan-mode lookalikes) gets `''`
 *   too, because there is no session whose role could justify the instruction.
 * - `enabled: false` turns the section off without removing the profile row.
 *
 * @module @anago-harness/response-language
 */
import type { Context, Volatile } from '@deepseek-ai/cordis'
import type { AssembleContext } from '@deepseek-ai/dsh-system-prompt'
import z from '@deepseek-ai/schemastery'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'response-language'

/** The prompt registry this row contributes to. */
export const inject = ['systemPrompt']

/** Stable section name, unique within the global prompt layer. */
export const RESPONSE_LANGUAGE_SECTION = 'response-language'

/**
 * Offset after the deployment persona suffix: the section is the last system
 * instruction, so a reply-language rule is not buried under tool guidance or a
 * deployment persona that a model may treat as the dominant instruction.
 */
export const RESPONSE_LANGUAGE_ORDER_OFFSET = 1

/**
 * The fixed instruction. English is deliberate: the surrounding prompt and
 * personas are English and `Japanese (日本語)` leaves no doubt about the target
 * language. "memory notes" keeps the answer Japanese even though memory bodies
 * are English, and the last sentence keeps delegated tasks English.
 */
export const RESPONSE_LANGUAGE_TEXT =
  'Always write your replies to the user in Japanese (日本語). This rule outranks the user\'s own language request: when the user writes in another language or explicitly asks you to answer in another language, still answer in Japanese and briefly note in Japanese that this harness answers in Japanese. The only exception is a translation request: deliver the requested translation, then explain it in Japanese. Keep code, commands, file paths, identifiers, and quoted text in their original form. Write tasks you pass to subagents in English.'

/** Plugin config: one live switch, so the row can be turned off in place. */
export interface Config {
  /** Whether the instruction is injected for main agents. */
  readonly enabled: Volatile<boolean>
}

export const Config = z.object({
  enabled: z.boolean().default(true).volatile(),
})

/**
 * The `agent` field of `AssembleContext`, contributed by `@deepseek-ai/dsh-agent`
 * through declaration merging. It is modeled structurally here so this package
 * depends only on cordis and `dsh-system-prompt`; the chain is the documented
 * `agent.session.header.delegationDepth`.
 */
interface AgentBearingAssembly {
  readonly agent?: {
    readonly session?: {
      readonly header?: {
        readonly delegationDepth?: number
      }
    }
  }
}

/**
 * Resolve the section text for one assembly.
 *
 * Empty text is how a section declines to contribute: `renderPrompt` filters
 * empty sections before joining, so an empty provider result leaves no trace
 * in the prompt.
 * @param context - the assembly context supplied by the prompt registry.
 * @returns the fixed instruction for a main agent, or `''` for a subagent
 *   child and for an assembly with no agent.
 */
export function responseLanguageText(context: AssembleContext): string {
  const agent = (context as AssembleContext & AgentBearingAssembly).agent
  if (agent === undefined) return ''
  // An absent depth means a top-level session, so it still gets the section.
  const depth = agent.session?.header?.delegationDepth ?? 0
  return depth > 0 ? '' : RESPONSE_LANGUAGE_TEXT
}

/**
 * Register the section in the calling context's scope (the plugin fiber), so
 * unloading the plugin removes it through the returned Cordis effect.
 * @param ctx - plugin context carrying the `systemPrompt` registry.
 * @param config - the currently authoritative settings section.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.systemPrompt.section({
    name: RESPONSE_LANGUAGE_SECTION,
    order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX') + RESPONSE_LANGUAGE_ORDER_OFFSET,
    interpolate: false,
    text: context => config.enabled.get() ? responseLanguageText(context) : '',
  })
}
