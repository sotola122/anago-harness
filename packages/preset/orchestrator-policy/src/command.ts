/**
 * Direct-invocation matching for external agent CLIs.
 *
 * The scan is synchronous and does not read files. A script, an interpreter
 * one-liner, or a name assembled by expansion is outside this match; that
 * limit is stated on the denial text.
 *
 * @module @deepseek-ai/dsh-orchestrator-policy/command
 */

/** Shells whose `-c` or `-Command` string is scanned one level with the same rules. */
const SHELLS = new Set(['bash', 'sh', 'pwsh'])

/** Wrappers whose flags and `NAME=value` assignments are skipped to reach the inner argv0. */
const WRAPPERS = new Set(['env', 'command', 'nice', 'nohup', 'timeout', 'stdbuf', 'time', 'xargs'])

/** Runners that deny when a later token's basename is listed. */
const PACKAGE_RUNNERS = new Set(['npx', 'bunx'])

/** Package managers whose `exec` or `dlx` verb is treated like {@link PACKAGE_RUNNERS}. */
const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn'])

interface Scan {
  readonly segments: readonly (readonly string[])[]
  readonly substitutions: readonly string[]
}

/**
 * Whether `command` directly starts a listed binary.
 *
 * Segments split on `;`, `&&`, `||`, `|`, `&`, and newline outside quotes.
 * Path-prefixed argv0 is compared by basename. `env`, `command`, `nice`,
 * `nohup`, `timeout`, `stdbuf`, `time`, and `xargs` skip flags and
 * `NAME=value`; `timeout` also skips one duration. `bash`, `sh`, and `pwsh`
 * rescan a `-c` or `-Command` string, including a bash/sh short-option cluster
 * that contains `c`. `npx`, `bunx`, and `npm`/`pnpm`/`yarn` `exec`/`dlx`
 * deny when a later token's basename is listed. `$(...)` and backticks are
 * scanned with the same rules.
 * @param command - the `bash` or `pwsh` `command` argument.
 * @param binaries - basename denylist, compared case-sensitively.
 * @returns true when a direct argv0 matches.
 */
export function commandInvokesBinary(command: string, binaries: ReadonlySet<string>): boolean {
  return invokes(command, binaries)
}

/** Recursive scan shared by the outer command, `-c` strings, and substitutions. */
function invokes(command: string, binaries: ReadonlySet<string>): boolean {
  const scanned = scan(command)
  return scanned.segments.some(tokens => segmentDenied(tokens, binaries))
    || scanned.substitutions.some(inner => invokes(inner, binaries))
}

/** True when one simple command's argv0, or a peeled inner command, is listed. */
function segmentDenied(tokens: readonly string[], binaries: ReadonlySet<string>): boolean {
  let index = 0
  while (index < tokens.length && isAssignment(tokens[index] ?? '')) index += 1
  while (index < tokens.length) {
    const argv0 = basename(tokens[index] ?? '')
    if (binaries.has(argv0)) return true
    if (PACKAGE_RUNNERS.has(argv0)) {
      return tokens.slice(index + 1).some(token => binaries.has(basename(token)))
    }
    if (PACKAGE_MANAGERS.has(argv0)) {
      const rest = tokens.slice(index + 1)
      const verbAt = rest.findIndex(token => !token.startsWith('-'))
      const verb = verbAt === -1 ? undefined : rest[verbAt]
      if (verb !== 'exec' && verb !== 'dlx') return false
      return rest.slice(verbAt + 1).some(token => binaries.has(basename(token)))
    }
    if (SHELLS.has(argv0)) {
      for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
        const flag = tokens[cursor] ?? ''
        const script = tokens[cursor + 1]
        if (isCommandFlag(argv0, flag) && script !== undefined && invokes(script, binaries)) return true
      }
      return false
    }
    if (!WRAPPERS.has(argv0)) return false
    index += 1
    while (index < tokens.length && (isFlag(tokens[index] ?? '') || isAssignment(tokens[index] ?? ''))) index += 1
    if (argv0 === 'timeout' && index < tokens.length && isDuration(tokens[index] ?? '')) index += 1
  }
  return false
}

/** Basename after the last `/` or `\`. */
function basename(token: string): string {
  const slash = Math.max(token.lastIndexOf('/'), token.lastIndexOf('\\'))
  return slash === -1 ? token : token.slice(slash + 1)
}

/** A leading `NAME=value` assignment, not an argv0. */
function isAssignment(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/u.test(token)
}

/** A flag token. Combined short options and `--name=value` both qualify. */
function isFlag(token: string): boolean {
  return token.startsWith('-') && token !== '-'
}

/** `timeout`'s positional duration, which is not a flag. */
function isDuration(token: string): boolean {
  return /^(?:\d+(?:\.\d+)?|\.\d+)[smhd]?$/u.test(token)
}

/**
 * Whether `token` introduces a shell command string.
 * @param shell - argv0 basename.
 * @param token - a later token in the same segment.
 * @returns true for `-c`, `-Command`, or a bash/sh short cluster containing `c`.
 */
function isCommandFlag(shell: string, token: string): boolean {
  if (token === '-c' || token === '-Command') return true
  return (shell === 'bash' || shell === 'sh') && /^-[^-]*c$/u.test(token)
}

/** Split one command into simple-command segments and substitution interiors. */
function scan(source: string): Scan {
  const segments: string[][] = []
  const substitutions: string[] = []
  let tokens: string[] = []
  let token = ''
  let quote: '"' | "'" | undefined
  let index = 0

  const flushToken = (): void => {
    if (token.length === 0) return
    tokens.push(token)
    token = ''
  }
  const flushSegment = (): void => {
    flushToken()
    if (tokens.length > 0) segments.push(tokens)
    tokens = []
  }

  while (index < source.length) {
    const ch = source[index] ?? ''
    if (quote === "'") {
      if (ch === "'") quote = undefined
      else token += ch
      index += 1
      continue
    }
    if (quote === '"') {
      if (ch === '\\' && index + 1 < source.length) {
        const next = source[index + 1] ?? ''
        if (next === '"' || next === '\\' || next === '$' || next === '`' || next === '\n') {
          if (next !== '\n') token += next
          index += 2
          continue
        }
      }
      if (ch === '"') {
        quote = undefined
        index += 1
        continue
      }
      if (ch === '`') {
        index = readBacktick(source, index, substitutions)
        continue
      }
      if (ch === '$' && source[index + 1] === '(') {
        index = readDollar(source, index, substitutions)
        continue
      }
      token += ch
      index += 1
      continue
    }
    if (ch === '\\' && index + 1 < source.length) {
      token += source[index + 1] ?? ''
      index += 2
      continue
    }
    if (ch === "'") {
      quote = "'"
      index += 1
      continue
    }
    if (ch === '"') {
      quote = '"'
      index += 1
      continue
    }
    if (ch === '`') {
      index = readBacktick(source, index, substitutions)
      continue
    }
    if (ch === '$' && source[index + 1] === '(') {
      index = readDollar(source, index, substitutions)
      continue
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      flushToken()
      index += 1
      continue
    }
    if (ch === '\n' || ch === ';' || ch === '|' || ch === '&') {
      if ((ch === '&' || ch === '|') && source[index + 1] === ch) index += 1
      flushSegment()
      index += 1
      continue
    }
    token += ch
    index += 1
  }
  flushSegment()
  return { segments, substitutions }
}

/** Record one backtick interior and return the index after the closer, or the end. */
function readBacktick(source: string, start: number, substitutions: string[]): number {
  let index = start + 1
  while (index < source.length && source[index] !== '`') index += 1
  substitutions.push(source.slice(start + 1, index))
  return index < source.length ? index + 1 : index
}

/**
 * Record one `$(...)` interior, counting parentheses and quotes, and return
 * the index after the closer, or the end when the closer is missing.
 */
function readDollar(source: string, start: number, substitutions: string[]): number {
  let index = start + 2
  let depth = 1
  let quote: '"' | "'" | undefined
  const begin = index
  while (index < source.length && depth > 0) {
    const ch = source[index] ?? ''
    if (quote === "'") {
      if (ch === "'") quote = undefined
      index += 1
      continue
    }
    if (quote === '"') {
      if (ch === '\\' && index + 1 < source.length) {
        index += 2
        continue
      }
      if (ch === '"') quote = undefined
      index += 1
      continue
    }
    if (ch === '\\' && index + 1 < source.length) {
      index += 2
      continue
    }
    if (ch === "'") {
      quote = "'"
      index += 1
      continue
    }
    if (ch === '"') {
      quote = '"'
      index += 1
      continue
    }
    if (ch === '(') depth += 1
    else if (ch === ')') depth -= 1
    if (depth === 0) break
    index += 1
  }
  substitutions.push(source.slice(begin, index))
  return index < source.length ? index + 1 : index
}
