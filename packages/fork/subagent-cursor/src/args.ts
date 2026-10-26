/**
 * Pure argv construction for one Cursor Agent CLI (`agent`) one-shot run.
 *
 * The provider owns a fixed flag set so that `extraArgs` can never weaken the
 * safety defaults (G3): every reserved flag is rejected before the process
 * boundary instead of being silently overridden by later-wins argv order.
 *
 * @module @anago-harness/subagent-cursor/args
 */
import type { ContentBlock } from '@deepseek-ai/dsh-llm'

/** `--output-format` values this provider passes to the CLI. */
export type OutputFormat = 'json' | 'text'

/**
 * `--mode` values this provider understands. `agent` is the provider's name for
 * "no `--mode` flag": the CLI only accepts `plan` and `ask`, and passing
 * `--mode agent` would fail its choices check.
 */
export type ExecutionMode = 'agent' | 'ask' | 'plan'

/** Task-size bound for one argv-borne prompt (Q2 fallback: argv, not stdin). */
export const MAX_TASK_BYTES = 65536

/**
 * Flags whose spelling the provider owns. An `extraArgs` element that names one
 * of these (in `--flag` or `--flag=value` form) is rejected at start.
 * `-p`/`-f` are the CLI's documented aliases for `--print`/`--force`, and
 * `--yolo` is its alias for `--force`; leaving them out would reopen the hole.
 * The remaining entries are the CLI's other posture-changing options
 * (`--endpoint`/`--api-key`/`--header` redirect or re-credential the API,
 * `--worktree`/`--add-dir`/`--plugin-dir` widen the child's reach,
 * `--approve-mcps`/`--continue`/`--resume` bypass prompting or replace the
 * requested one-shot conversation).
 */
export const RESERVED_FLAGS: readonly string[] = [
  '--print',
  '--output-format',
  '--sandbox',
  '--force',
  '--mode',
  '--workspace',
  '--trust',
  '--model',
  '--yolo',
  '--endpoint',
  '--api-key',
  '--header',
  '--add-dir',
  '--worktree',
  '--plugin-dir',
  '--approve-mcps',
  '--continue',
  '--resume',
  '-p',
  '-f',
  '-e',
  '-H',
  '-w',
]

/**
 * Letters owned by a reserved short option (`-p` -> `p`). A clustered short
 * option such as `-pf` spells the same flags as `-p -f`, so each letter of a
 * `-`-led cluster is checked against this set (case-sensitive: `-H` and `-h`
 * are different CLI options).
 */
const RESERVED_SHORT_OPTIONS: ReadonlySet<string> = new Set(
  RESERVED_FLAGS.filter(flag => /^-[^-]$/.test(flag)).map(flag => flag.slice(1)),
)

/**
 * The CLI's own name for its one-shot agent subcommand, spelled between the
 * options and the task.
 *
 * The root command declares `[command] [prompt...]`, so the first operand
 * selects a subcommand whenever it happens to match one (`help`, `logout`,
 * `update`, …) and the task would never reach the agent. Spelling the command
 * slot explicitly means the task always lands in the prompt slot: verified
 * against the real CLI, `… agent 'help'` returns a normal JSON result whose
 * `result` answers the prompt, while a bare `'help'` prints the CLI's help.
 */
export const CLI_AGENT_SUBCOMMAND = 'agent'

/**
 * The CLI's own subcommand names, taken from the `Commands:` block of
 * `agent --help` (`status|whoami` and `generate-rule|rule` contribute both
 * spellings). Spelling {@link CLI_AGENT_SUBCOMMAND} before the task already
 * keeps these names out of the command slot; this list stays as a second line
 * of defence should a future CLI stop accepting that command word, and
 * rejecting a task that is exactly one of these names is the fail-closed side.
 */
export const CLI_SUBCOMMAND_NAMES: readonly string[] = [
  'persist',
  'install-shell-integration',
  'uninstall-shell-integration',
  'login',
  'logout',
  'mcp',
  'plugin',
  'worker',
  'status',
  'whoami',
  'models',
  'team',
  'bedrock',
  'about',
  'update',
  'create-chat',
  'generate-rule',
  'rule',
  'ls',
  'resume',
  'help',
  'agent',
]

/** Provider-owned argv options for one run. */
export interface ArgvOptions {
  /** `--output-format` value. */
  readonly outputFormat: OutputFormat
  /** `--sandbox enabled|disabled`; `true` emits `enabled` (default posture). */
  readonly sandbox: boolean
  /** Emit `--trust` (skip the workspace trust prompt in print mode). */
  readonly trust: boolean
  /** Emit `--force` (Run Everything); off by default. */
  readonly force: boolean
  /** Execution mode; `agent` emits no `--mode` at all. */
  readonly mode: ExecutionMode
  /** `--model` value; omitted means "use the CLI default". */
  readonly model?: string | undefined
  /** Extra arguments appended after the provider-owned flags. */
  readonly extraArgs?: readonly string[] | undefined
}

/**
 * Reject an `extraArgs` element that restates a provider-owned flag.
 *
 * Two spellings are covered: an element whose option name is reserved
 * (`--sandbox`, `--sandbox=disabled`, `-e`, …) and a clustered short option
 * (`-pf`, `-ehttps://evil.example`) whose letters include a reserved short
 * option, which the CLI expands to the same flags.
 * @param extraArgs - raw caller-supplied arguments.
 * @throws when an element names a reserved flag, including its `=` form or a
 * clustered short-option form.
 */
export function assertNoReservedArgs(extraArgs: readonly string[]): void {
  for (const arg of extraArgs) {
    const equals = arg.indexOf('=')
    const name = arg.startsWith('--') && equals > 0 ? arg.slice(0, equals) : arg
    if (RESERVED_FLAGS.includes(name)) {
      throw new Error(
        `subagent-cursor: extraArgs must not restate the provider-owned flag "${name}"`,
      )
    }
    if (!arg.startsWith('-') || arg.startsWith('--')) continue
    for (const letter of arg.slice(1)) {
      if (RESERVED_SHORT_OPTIONS.has(letter)) {
        throw new Error(
          `subagent-cursor: extraArgs must not restate the provider-owned flag "-${letter}" (found inside the clustered short options "${arg}")`,
        )
      }
    }
  }
}

/**
 * Validate one already-flattened task before it becomes an argv operand.
 *
 * A task beginning with `-` is rejected rather than escaped: the CLI's root
 * command declares a `[command] [prompt...]` operand pair, so a `--` separator
 * would be re-parsed as an operand instead of ending option parsing, and the
 * task text would be free to select CLI options (an argv injection).
 *
 * A task that is *exactly* one of the CLI's subcommand names is rejected as
 * well. The structural fix is in {@link buildArgv} (the task never occupies the
 * `[command]` slot); this check is the secondary defence for a future CLI that
 * stops accepting the explicit command word, and refusing to delegate is its
 * fail-closed side. The comparison trims surrounding whitespace and ignores
 * case, and rejects whole-string matches only, so a task that merely mentions a
 * subcommand name ("resume the upload") still passes.
 * @param task - the flattened task text.
 * @throws when the task is empty, `-`-led, a CLI subcommand name, or over
 * {@link MAX_TASK_BYTES}.
 */
export function assertTaskText(task: string): void {
  if (task.trim().length === 0) {
    throw new Error('subagent-cursor: the one-shot task must not be empty')
  }
  if (task.startsWith('-')) {
    throw new Error(
      'subagent-cursor: the one-shot task must not begin with "-" (the CLI would read it as an option)',
    )
  }
  const normalized = task.trim().toLowerCase()
  if (CLI_SUBCOMMAND_NAMES.includes(normalized)) {
    throw new Error(
      `subagent-cursor: the one-shot task "${task.trim()}" collides with the Cursor CLI subcommand "${normalized}"; refusing to delegate it as a prompt`,
    )
  }
  const bytes = Buffer.byteLength(task, 'utf8')
  if (bytes > MAX_TASK_BYTES) {
    throw new Error(
      `subagent-cursor: the one-shot task must not exceed ${MAX_TASK_BYTES} UTF-8 bytes (got ${bytes})`,
    )
  }
}

/**
 * Flatten the request's content blocks into the one task string the CLI takes.
 * Only text blocks can cross the argv boundary; anything else is rejected
 * rather than dropped, so no task content disappears silently.
 * @param prompt - the resolved start request's prompt blocks.
 * @returns the concatenated task text.
 * @throws when a block is not text, or the task fails {@link assertTaskText}.
 */
export function flattenPrompt(prompt: readonly ContentBlock[]): string {
  const texts: string[] = []
  for (const block of prompt) {
    if (block.type !== 'text') {
      throw new Error(
        `subagent-cursor: the one-shot task must contain only text blocks (found "${block.type}")`,
      )
    }
    texts.push(block.text)
  }
  const task = texts.join('')
  assertTaskText(task)
  return task
}

/**
 * Build the CLI arguments for one run, in the order the design fixes:
 * `--print`, `--output-format`, `--sandbox`, `--trust`, `--workspace`,
 * `--mode` (ask/plan only), `--model`, `--force`, extra arguments,
 * {@link CLI_AGENT_SUBCOMMAND}, task.
 *
 * The command word is an operand and therefore sits after every option: it
 * fills the root command's `[command]` slot so the task can only ever be read
 * as the prompt, whatever it spells.
 * @param options - provider-owned flags.
 * @param task - flattened task text (validated here as well).
 * @param cwd - absolute child workspace passed to `--workspace`.
 * @returns the argument vector without `argv[0]`.
 * @throws when `extraArgs` collides or the task text is unusable.
 */
export function buildArgv(options: ArgvOptions, task: string, cwd: string): string[] {
  const extraArgs = options.extraArgs ?? []
  assertNoReservedArgs(extraArgs)
  assertTaskText(task)
  const argv: string[] = [
    '--print',
    '--output-format',
    options.outputFormat,
    '--sandbox',
    options.sandbox ? 'enabled' : 'disabled',
  ]
  if (options.trust) argv.push('--trust')
  argv.push('--workspace', cwd)
  if (options.mode !== 'agent') argv.push('--mode', options.mode)
  if (options.model !== undefined) argv.push('--model', options.model)
  if (options.force) argv.push('--force')
  argv.push(...extraArgs, CLI_AGENT_SUBCOMMAND, task)
  return argv
}
