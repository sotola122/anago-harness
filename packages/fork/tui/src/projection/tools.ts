/**
 * Pure tool-card projection: turn one tool call and its result into the facts,
 * preview, and bounded output a transcript card renders.
 *
 * The input arrives as the raw model arguments and the durable
 * `tool/result.meta` payload. Known tools get a specific reading; every other
 * name falls back to the generic argument and result summary so an unknown or
 * experimental tool still renders a useful card.
 * @module @anago-harness/tui/projection/tools
 */

/** Maximum characters of a collapsed result preview. */
export const TOOL_PREVIEW_LIMIT = 160

/** Maximum characters retained for the expanded result view. */
export const TOOL_OUTPUT_LIMIT = 8_000

/** The compact description of one tool invocation. */
export interface ToolInvocation {
  /** One-line summary shown next to the tool name. */
  readonly summary: string
  /** Identifying command or path shown beneath the summary, when one exists. */
  readonly detail?: string
}

/** The result-side facts of one tool call. */
export interface ToolResultSummary {
  /** One-line collapsed preview. */
  readonly preview: string
  /** Bounded result text for the expanded view. */
  readonly output: string
  /** Additional facts extracted from the tool's presentation metadata. */
  readonly facts: readonly string[]
}

/**
 * Collapse arbitrary text to one bounded display line.
 * @param text - source text.
 * @param limit - maximum characters to keep.
 * @returns the collapsed and bounded line.
 */
export function summarizeText(text: string, limit = TOOL_PREVIEW_LIMIT): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length <= limit ? collapsed : `${collapsed.slice(0, limit - 1)}…`
}

/**
 * Read one field of an unknown value without trusting its shape.
 * @param value - candidate object.
 * @param key - field name.
 * @returns the field value, or `undefined` when it is absent or not an object.
 */
function readField(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object') return undefined
  if (!(key in value)) return undefined
  return (value as Record<string, unknown>)[key]
}

/**
 * Read a non-empty string field.
 * @param value - candidate object.
 * @param key - field name.
 * @returns the string, or `undefined`.
 */
function readString(value: unknown, key: string): string | undefined {
  const field = readField(value, key)
  return typeof field === 'string' && field.trim() !== '' ? field : undefined
}

/**
 * Read a finite number field.
 * @param value - candidate object.
 * @param key - field name.
 * @returns the number, or `undefined`.
 */
function readNumber(value: unknown, key: string): number | undefined {
  const field = readField(value, key)
  return typeof field === 'number' && Number.isFinite(field) ? field : undefined
}

/**
 * Read an array field.
 * @param value - candidate object.
 * @param key - field name.
 * @returns the array, or `undefined` when the field is not an array.
 */
function readArray(value: unknown, key: string): readonly unknown[] | undefined {
  const field = readField(value, key)
  return Array.isArray(field) ? field : undefined
}

/**
 * Parse model-supplied argument JSON.
 * @param raw - raw argument string; truncated streams are expected.
 * @returns the object fields, or `undefined` when the text is not a JSON object.
 */
function argumentObject(raw: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(raw)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
    return value as Record<string, unknown>
  } catch (error) {
    // Tool arguments may be truncated while streaming; the raw text is still useful.
    if (!(error instanceof SyntaxError)) throw error
    return undefined
  }
}

/**
 * Find a string argument field from a list of accepted aliases.
 * @param args - parsed argument object.
 * @param keys - field names in preference order.
 * @returns the first non-empty string value.
 */
function argumentString(args: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = args[key]
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return undefined
}

/**
 * Read the file path argument shared by the filesystem tools.
 * @param args - parsed argument object.
 * @returns the path, or `undefined`.
 */
function pathArgument(args: Record<string, unknown>): string | undefined {
  return argumentString(args, ['file_path', 'filePath', 'path'])
}

/**
 * Describe a single tool invocation from its raw argument JSON.
 *
 * Known tool families read their identifying field: shell tools prefer the
 * model's display description and keep the command as a detail line,
 * filesystem tools show the path, search tools show the pattern, and unknown
 * tools fall back to the first useful argument or the raw text.
 * @param name - tool name.
 * @param rawArguments - JSON string supplied by the model.
 * @returns the summary and optional detail line.
 */
export function describeToolInvocation(name: string, rawArguments: string): ToolInvocation {
  const args = argumentObject(rawArguments)
  if (args === undefined) {
    const fallback = summarizeText(rawArguments, 80)
    return { summary: fallback === '' ? name : fallback }
  }

  switch (name) {
    case 'bash':
    case 'pwsh': {
      const command = argumentString(args, ['command', 'cmd'])
      const description = argumentString(args, ['description'])
      if (command !== undefined) {
        return description === undefined
          ? { summary: summarizeText(command) }
          : { summary: summarizeText(description), detail: `$ ${command}` }
      }
      break
    }
    case 'read':
    case 'read_image':
    case 'write':
    case 'edit':
    case 'str_replace_editor': {
      const path = pathArgument(args)
      if (path !== undefined) {
        const offset = readNumber(args, 'offset')
        return offset === undefined
          ? { summary: summarizeText(path) }
          : { summary: summarizeText(path), detail: `from line ${String(offset)}` }
      }
      break
    }
    case 'grep':
    case 'glob': {
      const pattern = argumentString(args, ['pattern', 'query'])
      const path = argumentString(args, ['path'])
      if (pattern !== undefined) {
        return path === undefined
          ? { summary: summarizeText(pattern) }
          : { summary: summarizeText(pattern), detail: path }
      }
      break
    }
    case 'web_search': {
      const query = argumentString(args, ['query', 'q'])
      if (query !== undefined) return { summary: summarizeText(query) }
      break
    }
    case 'web_fetch': {
      const url = argumentString(args, ['url'])
      if (url !== undefined) return { summary: summarizeText(url) }
      break
    }
    case 'todo_write': {
      const todos = readArray(args, 'todos')
      if (todos !== undefined) return { summary: `${String(todos.length)} items` }
      break
    }
    case 'ask_user_question': {
      const questions = readArray(args, 'questions')
      if (questions !== undefined) {
        return { summary: questions.length === 1 ? '1 question' : `${String(questions.length)} questions` }
      }
      break
    }
    case 'skill': {
      const skill = argumentString(args, ['name', 'skill'])
      if (skill !== undefined) return { summary: summarizeText(skill) }
      break
    }
    default:
      break
  }

  const fallback = argumentString(args, [
    'command', 'cmd', 'file_path', 'filePath', 'path', 'query', 'q', 'pattern', 'url', 'description', 'name',
  ])
  if (fallback !== undefined) return { summary: summarizeText(fallback) }
  const strings = stringArrayArgument(args)
  if (strings !== undefined) return { summary: summarizeText(strings.join(' ')) }
  return { summary: summarizeText(rawArguments, 80) || name }
}

/**
 * Read the first all-string array argument, as query-list tools supply.
 * @param args - parsed argument object.
 * @returns the string list, or `undefined`.
 */
function stringArrayArgument(args: Record<string, unknown>): readonly string[] | undefined {
  for (const value of Object.values(args)) {
    if (!Array.isArray(value)) continue
    const strings = value.filter((item): item is string => typeof item === 'string')
    if (strings.length === value.length && strings.length > 0) return strings
  }
  return undefined
}

/**
 * Backwards-compatible one-line description of a tool invocation.
 * @param name - tool name.
 * @param rawArguments - JSON string supplied by the model.
 * @returns the summary line.
 */
export function summarizeToolCall(name: string, rawArguments: string): string {
  return describeToolInvocation(name, rawArguments).summary
}

/**
 * Count changed lines represented by one diff payload.
 * @param diff - a `{ oldText, newText }` entry from tool presentation metadata.
 * @returns added and removed line counts.
 */
function diffStats(diff: unknown): { added: number; removed: number } {
  const oldText = readString(diff, 'oldText') ?? ''
  const newText = readString(diff, 'newText') ?? ''
  const count = (text: string): number => text === '' ? 0 : text.split('\n').length
  return { added: count(newText), removed: count(oldText) }
}

/**
 * Collect context facts from one known presentation-metadata payload.
 *
 * Diff statistics and read windows belong to the collapsed preview, so this
 * list carries only facts the preview does not already state.
 * @param meta - durable `tool/result.meta` value.
 * @returns display facts in reading order.
 */
function metaFacts(meta: unknown): string[] {
  const facts: string[] = []
  const cwd = readString(meta, 'cwd')
  if (cwd !== undefined) facts.push(`cwd ${cwd}`)
  const operation = readString(meta, 'operation')
  if (operation !== undefined) facts.push(`operation ${operation}`)
  const jobId = readString(meta, 'jobId')
  if (jobId !== undefined) facts.push(`job ${jobId}`)
  const exitCode = readNumber(meta, 'exitCode') ?? readNumber(meta, 'exit_code')
  if (exitCode !== undefined) facts.push(`exit ${String(exitCode)}`)
  return facts
}

/**
 * Describe the result side of one tool call.
 *
 * The collapsed preview prefers a known-tool fact (a read window or a diff
 * summary) and otherwise takes the first result line. The expanded output keeps
 * a bounded prefix of the complete result so a long command cannot grow the
 * transcript without limit.
 * @param options - tool name, result text, durable metadata, and failure flag.
 * @param options.name - tool name.
 * @param options.text - model-facing result text.
 * @param options.meta - durable `tool/result.meta` value, when recorded.
 * @param options.failed - whether the result is an error.
 * @param options.errorReason - user-facing failure reason, when one was recorded.
 * @returns the preview, bounded output, and facts.
 */
export function summarizeToolResult(options: {
  readonly name: string
  readonly text: string
  readonly meta: unknown
  readonly failed: boolean
  readonly errorReason?: string | undefined
}): ToolResultSummary {
  const trimmed = options.text.trim()
  const facts = metaFacts(options.meta)
  const output = trimmed.length <= TOOL_OUTPUT_LIMIT
    ? trimmed
    : `${trimmed.slice(0, TOOL_OUTPUT_LIMIT)}\n… truncated`
  let preview: string
  if (trimmed !== '') {
    const metadataPreview = knownPreview(options.name, options.meta)
    preview = metadataPreview ?? summarizeText(firstLine(trimmed))
  } else if (options.errorReason !== undefined && options.errorReason.trim() !== '') {
    preview = summarizeText(options.errorReason)
  } else {
    preview = options.failed ? 'failed without a message' : 'no output'
  }
  return { preview, output, facts }
}

/**
 * Build a card preview from known metadata rather than raw result text.
 * @param name - tool name.
 * @param meta - durable presentation metadata.
 * @returns the preview, or `undefined` when the tool has no specific reading.
 */
function knownPreview(name: string, meta: unknown): string | undefined {
  const diffs = readArray(meta, 'diffs')
  if (diffs !== undefined && diffs.length > 0) {
    const stats = diffStats(diffs[0])
    return `+${String(stats.added)} −${String(stats.removed)}${diffs.length === 1 ? '' : ` · ${String(diffs.length)} files`}`
  }
  const lines = readArray(meta, 'lines')
  if (name === 'read' && lines !== undefined && lines.length > 0) {
    const totalLines = readNumber(meta, 'totalLines')
    return totalLines === undefined
      ? `${String(lines.length)} lines`
      : `${String(lines.length)} of ${String(totalLines)} lines`
  }
  const jobId = readString(meta, 'jobId')
  if (jobId !== undefined) return `job ${jobId}`
  return undefined
}

/**
 * First non-empty line of a multi-line result.
 * @param text - trimmed result text.
 * @returns the first line.
 */
function firstLine(text: string): string {
  const end = text.indexOf('\n')
  return end === -1 ? text : text.slice(0, end)
}

/**
 * Format a call duration for the card heading.
 * @param milliseconds - elapsed time in milliseconds.
 * @returns a compact duration such as `12ms`, `1.4s`, or `2m 3s`.
 */
export function formatDuration(milliseconds: number): string {
  const bounded = Math.max(0, milliseconds)
  if (bounded < 1_000) return `${String(Math.round(bounded))}ms`
  const seconds = bounded / 1_000
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : String(Math.round(seconds))}s`
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes)}m ${String(Math.round(seconds % 60))}s`
}

