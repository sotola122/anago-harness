/**
 * Pure argv construction and prompt flattening for one Pi CLI one-shot run.
 *
 * The Pi CLI takes its task as the final operand. `--` ends option parsing
 * before the task, so prompt text is never re-read as an option; no task text
 * is rejected for looking like a flag. The provider owns the full flag set, so
 * a deployment cannot widen or redirect the child through unlisted arguments.
 *
 * @module @anago-harness/subagent-pi/args
 */
import type { ContentBlock } from '@deepseek-ai/dsh-llm'

/** Diagnostic prefix shared by every provider failure. */
const PREFIX = 'subagent-pi'

/** Thinking levels accepted by the Pi CLI's `--thinking` option. */
export const PI_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/** One `--thinking` level understood by the Pi CLI. */
export type PiThinkingLevel = (typeof PI_THINKING_LEVELS)[number]

/**
 * Upper bound for the flattened task. The task travels in argv rather than on
 * stdin, so the whole argument vector shares the platform's fixed argv budget.
 */
export const MAX_PROMPT_BYTES = 65_536

/** Provider-owned settings one run's argv is built from. */
export interface PiArgvOptions {
  /** Optional Pi provider id; the CLI requires `model` alongside it. */
  readonly provider?: string | undefined
  /** Optional `--model` pattern or id; absent uses the CLI's own model. */
  readonly model?: string | undefined
  /** Optional `--thinking` level. */
  readonly thinking?: PiThinkingLevel | undefined
  /** Optional `--tools` allowlist; an empty list becomes `--no-tools`. */
  readonly tools?: readonly string[] | undefined
  /** Optional `--exclude-tools` denylist; an empty list emits nothing. */
  readonly excludeTools?: readonly string[] | undefined
  /** Emit `--approve` (true) or `--no-approve` (false) for project-local files. */
  readonly approve: boolean
  /** Absolute session directory; absent emits `--no-session`. */
  readonly sessionDir?: string | undefined
}

/**
 * Flatten prompt blocks into the single task string the CLI accepts.
 *
 * The argv boundary carries text only, so a block of any other type is
 * rejected instead of being silently dropped, and a prompt with no text block
 * cannot produce a run.
 * @param prompt - the resolved start request's prompt blocks.
 * @returns the concatenated task text.
 * @throws when a block is not text, no text block is present, the text is
 * empty, or the task exceeds {@link MAX_PROMPT_BYTES}.
 */
export function flattenPrompt(prompt: readonly ContentBlock[]): string {
  const texts: string[] = []
  for (const block of prompt) {
    if (block.type !== 'text') {
      throw new Error(
        `${PREFIX}: the prompt must contain only text blocks (found "${block.type}"); the Pi CLI receives its task in argv, so inline any attachment as text`,
      )
    }
    texts.push(block.text)
  }
  if (texts.length === 0) {
    throw new Error(
      `${PREFIX}: the prompt must contain at least one text block; the Pi CLI receives its task in argv`,
    )
  }
  const task = texts.join('')
  if (task.trim().length === 0) {
    throw new Error(`${PREFIX}: the one-shot task must not be empty`)
  }
  const bytes = Buffer.byteLength(task, 'utf8')
  if (bytes > MAX_PROMPT_BYTES) {
    throw new Error(
      `${PREFIX}: the one-shot task must not exceed ${MAX_PROMPT_BYTES} UTF-8 bytes (got ${bytes}); shorten the task or point the child at a file containing the detail`,
    )
  }
  return task
}

/**
 * Reject list entries that cannot survive the CLI's comma-separated value.
 * @param fieldName - config field name for the diagnostic.
 * @param values - configured tool names or patterns.
 * @throws when an entry is empty or contains `,`.
 */
export function assertToolList(fieldName: string, values: readonly string[]): void {
  for (const value of values) {
    if (value.length === 0) {
      throw new Error(`${PREFIX}: ${fieldName} must not contain an empty tool name`)
    }
    if (value.includes(',')) {
      throw new Error(
        `${PREFIX}: ${fieldName} entries must not contain "," (the Pi CLI splits this option on commas): ${value}`,
      )
    }
  }
}

/**
 * Build the CLI arguments for one run, in the order the design fixes:
 * `--print`, `--mode json`, `--provider`, `--model`, `--thinking`, tools,
 * exclusions, approval, session, then `--` and the task.
 * @param options - provider-owned settings.
 * @param task - flattened task text.
 * @returns the argument vector without `argv[0]`.
 */
export function buildArgv(options: PiArgvOptions, task: string): string[] {
  const argv: string[] = ['--print', '--mode', 'json']
  if (options.provider !== undefined) argv.push('--provider', options.provider)
  if (options.model !== undefined) argv.push('--model', options.model)
  if (options.thinking !== undefined) argv.push('--thinking', options.thinking)
  if (options.tools !== undefined) {
    argv.push(...toolsArgs(options.tools))
  }
  if (options.excludeTools !== undefined && options.excludeTools.length > 0) {
    argv.push('--exclude-tools', options.excludeTools.join(','))
  }
  argv.push(options.approve ? '--approve' : '--no-approve')
  if (options.sessionDir === undefined) argv.push('--no-session')
  else argv.push('--session-dir', options.sessionDir)
  argv.push('--', task)
  return argv
}

/**
 * Render the tool-selection flags: an explicitly empty allowlist disables all
 * tools, because `--tools ""` would be read as an empty name rather than "none".
 * @param tools - configured allowlist.
 * @returns the flags to append.
 */
function toolsArgs(tools: readonly string[]): string[] {
  return tools.length === 0 ? ['--no-tools'] : ['--tools', tools.join(',')]
}
