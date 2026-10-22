/**
 * Slash commands and their completion popup.
 *
 * The command set is owned by the TUI: `/help`, `/model`, `/clear`, `/resume`,
 * and `/quit`. Parsing, filtering, and completion are pure so the editor's
 * existing autocomplete key handling can drive them without terminal input in
 * tests. Commands registered by other plugins (`ctx.commands`) are not bridged
 * yet.
 * @module @anago-harness/tui/app/commands
 */

import type { AutocompleteItem, AutocompleteProvider, AutocompleteSuggestions } from '../term/pi-tui.ts'

/** One command offered by the prompt editor. */
export interface SlashCommandInfo {
  /** Lowercase command name without the leading slash. */
  readonly name: string
  /** One-line description shown in the completion popup and `/help`. */
  readonly description: string
  /** Usage line shown by `/help`. */
  readonly usage: string
}

/** Slash commands this terminal UI owns. */
export const SLASH_COMMANDS: readonly SlashCommandInfo[] = Object.freeze([
  { name: 'help', description: 'show commands and keys', usage: '/help' },
  { name: 'model', description: 'choose the provider and model for later turns', usage: '/model' },
  { name: 'clear', description: 'start a new Session', usage: '/clear' },
  { name: 'resume', description: 'continue a stored Session', usage: '/resume' },
  { name: 'quit', description: 'exit the terminal UI', usage: '/quit' },
])

/** One syntactically valid slash command. */
export interface ParsedSlashCommand {
  /** Lowercase command name without the leading slash. */
  readonly name: string
  /** Trimmed text following the command name. */
  readonly args: string
}

/** The completion context of the prompt line. */
export interface SlashCompletion {
  /** Suggestions in command declaration order. */
  readonly items: readonly AutocompleteItem[]
  /** Text the completion replaces, including its leading slash. */
  readonly prefix: string
}

/**
 * Parse one submitted line as a slash command.
 * @param text - submitted editor text.
 * @returns the parsed command, or `undefined` for ordinary prompt text.
 */
export function parseSlashInput(text: string): ParsedSlashCommand | undefined {
  const trimmed = text.trimStart()
  const match = /^\/([a-z][a-z0-9_-]*)(?=$|[\t\n\r ])/u.exec(trimmed)
  if (match === null) return undefined
  const name = match[1]
  if (name === undefined) return undefined
  return { name, args: trimmed.slice(match[0].length).trim() }
}

/**
 * Find a command by name.
 * @param name - command name without the leading slash.
 * @returns the declaration, or `undefined` for an unknown command.
 */
export function commandByName(name: string): SlashCommandInfo | undefined {
  return SLASH_COMMANDS.find(command => command.name === name)
}

/**
 * Filter commands by the typed prefix.
 *
 * Matching is case-insensitive and prefix-based because command names are
 * short; the empty prefix lists every command.
 * @param query - typed text after the slash.
 * @returns matching commands in declaration order.
 */
export function filterSlashCommands(query: string): readonly SlashCommandInfo[] {
  const needle = query.toLowerCase()
  return SLASH_COMMANDS.filter(command => command.name.startsWith(needle))
}

/**
 * Build `/help` text for the transcript.
 * @returns one line per command plus the key reference.
 */
export function helpText(): string {
  const commands = SLASH_COMMANDS.map(command => `${command.usage.padEnd(9)} ${command.description}`)
  return [
    'Commands',
    ...commands,
    '',
    'Keys',
    '  Enter        submit; steer while a turn is running',
    '  Esc          abort the running turn',
    '  Ctrl+C ×2    quit',
    '  Ctrl+P       choose a model',
    '  Ctrl+R       choose a stored Session',
    '  Ctrl+O       expand the newest tool or reasoning card',
  ].join('\n')
}

/**
 * Suggest commands for the text before the cursor.
 *
 * Only the first editor line participates, matching the library's slash-menu
 * rule, and the typed token must not contain whitespace yet.
 * @param lines - editor lines.
 * @param cursorLine - zero-based cursor line.
 * @param cursorCol - zero-based cursor column.
 * @returns completion state, or `null` when the cursor is not in a command token.
 */
export function slashCompletion(
  lines: readonly string[],
  cursorLine: number,
  cursorCol: number,
): SlashCompletion | null {
  if (cursorLine !== 0) return null
  const line = lines[0] ?? ''
  const leading = line.length - line.trimStart().length
  const start = Math.min(Math.max(leading, 0), cursorCol)
  const prefix = line.slice(start, cursorCol)
  if (!prefix.startsWith('/') || /\s/u.test(prefix)) return null
  const matches = filterSlashCommands(prefix.slice(1))
  if (matches.length === 0) return null
  return {
    items: matches.map(command => ({
      value: command.name,
      label: command.name,
      description: command.description,
    })),
    prefix,
  }
}

/**
 * Replace the typed command token with the selected command name.
 * @param lines - editor lines.
 * @param cursorLine - cursor line.
 * @param cursorCol - cursor column.
 * @param item - selected suggestion.
 * @param prefix - completion prefix from {@link slashCompletion}.
 * @returns the rewritten lines and cursor position.
 */
export function applySlashCompletion(
  lines: readonly string[],
  cursorLine: number,
  cursorCol: number,
  item: AutocompleteItem,
  prefix: string,
): { lines: string[]; cursorLine: number; cursorCol: number } {
  const currentLine = lines[cursorLine] ?? ''
  const beforePrefix = currentLine.slice(0, cursorCol - prefix.length)
  const afterCursor = currentLine.slice(cursorCol)
  const nextLines = [...lines]
  nextLines[cursorLine] = `${beforePrefix}/${item.value} ${afterCursor}`
  return {
    lines: nextLines,
    cursorLine,
    cursorCol: beforePrefix.length + item.value.length + 2,
  }
}

/** Autocomplete provider backing the editor's `/` popup. */
export class SlashCommandProvider implements AutocompleteProvider {
  /**
   * Suggest commands for the current editor position.
   * @param lines - editor lines.
   * @param cursorLine - cursor line.
   * @param cursorCol - cursor column.
   * @returns the suggestions, or `null` when no popup should open.
   */
  getSuggestions(
    lines: readonly string[],
    cursorLine: number,
    cursorCol: number,
  ): Promise<AutocompleteSuggestions | null> {
    const completion = slashCompletion(lines, cursorLine, cursorCol)
    return Promise.resolve(completion === null
      ? null
      : { items: [...completion.items], prefix: completion.prefix })
  }

  /**
   * Apply one selected command.
   * @param lines - editor lines.
   * @param cursorLine - cursor line.
   * @param cursorCol - cursor column.
   * @param item - selected suggestion.
   * @param prefix - completion prefix.
   * @returns the rewritten editor state.
   */
  applyCompletion(
    lines: readonly string[],
    cursorLine: number,
    cursorCol: number,
    item: AutocompleteItem,
    prefix: string,
  ): { lines: string[]; cursorLine: number; cursorCol: number } {
    return applySlashCompletion(lines, cursorLine, cursorCol, item, prefix)
  }
}
