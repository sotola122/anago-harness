/**
 * Terminal themes for the TUI: plain SGR styling shared by the transcript,
 * status line, editor, and dialogs.
 * @module @anago-harness/tui/app/theme
 */

import type { EditorTheme, MarkdownTheme, SelectListTheme } from '../term/pi-tui.ts'

/** A named terminal palette. */
export interface Theme {
  /** Palette name; the only two values `Config.theme` accepts. */
  readonly name: 'dark' | 'light'
  /** User-authored transcript text. */
  readonly user: (text: string) => string
  /** Assistant-authored transcript text. */
  readonly assistant: (text: string) => string
  /** Tool call and result summaries. */
  readonly tool: (text: string) => string
  /** Failed operation text. */
  readonly error: (text: string) => string
  /** Informational notices such as lifecycle messages. */
  readonly notice: (text: string) => string
  /** Success markers. */
  readonly success: (text: string) => string
  /** Dimmed secondary text. */
  readonly dim: (text: string) => string
  /** Bold emphasis. */
  readonly bold: (text: string) => string
  /** Dialog and editor border. */
  readonly border: (text: string) => string
  /** Accent used for headings and selection. */
  readonly accent: (text: string) => string
  /** Markdown element styling. */
  readonly markdown: MarkdownTheme
  /** Editor styling. */
  readonly editor: EditorTheme
  /** Select-list styling. */
  readonly select: SelectListTheme
}

type Styler = (text: string) => string

/**
 * Build one SGR wrapper.
 * @param open - SGR sequence that turns the style on.
 * @returns a function that wraps text and appends a reset.
 */
function sgr(open: string): Styler {
  return text => `${open}${text}\x1b[0m`
}

const RESET = '\x1b[0m'

/**
 * Build a theme from its palette-specific SGR codes.
 * @param name - palette name.
 * @param codes - opening sequences for the theme roles.
 * @returns the complete theme, including the component themes derived from it.
 */
function buildTheme(name: Theme['name'], codes: {
  accent: string
  border: string
  user: string
  assistant: string
  tool: string
  error: string
  success: string
}): Theme {
  const accent = sgr(codes.accent)
  const border = sgr(codes.border)
  const user = sgr(codes.user)
  const assistant = sgr(codes.assistant)
  const tool = sgr(codes.tool)
  const error = sgr(codes.error)
  const success = sgr(codes.success)
  const dim = sgr('\x1b[2m')
  const bold = sgr('\x1b[1m')
  const italic = sgr('\x1b[3m')
  const underline = sgr('\x1b[4m')
  const strike = sgr('\x1b[9m')

  const select: SelectListTheme = {
    selectedPrefix: accent,
    selectedText: bold,
    description: dim,
    scrollInfo: dim,
    noMatch: dim,
  }

  const markdown: MarkdownTheme = {
    heading: text => bold(accent(text)),
    link: text => underline(accent(text)),
    linkUrl: dim,
    code: text => `${codes.tool}${text}${RESET}`,
    codeBlock: text => `${codes.tool}${text}${RESET}`,
    codeBlockBorder: border,
    quote: italic,
    quoteBorder: border,
    hr: border,
    listBullet: accent,
    bold,
    italic,
    strikethrough: strike,
    underline,
  }

  return {
    name,
    user,
    assistant,
    tool,
    error,
    notice: dim,
    success,
    dim,
    bold,
    border,
    accent,
    markdown,
    select,
    editor: { borderColor: border, selectList: select },
  }
}

/** Dark-background palette, chosen for the default terminal appearance. */
const dark = buildTheme('dark', {
  accent: '\x1b[36m',
  border: '\x1b[90m',
  user: '\x1b[36m',
  assistant: '\x1b[37m',
  tool: '\x1b[33m',
  error: '\x1b[31m',
  success: '\x1b[32m',
})

/** Light-background palette. */
const light = buildTheme('light', {
  accent: '\x1b[34m',
  border: '\x1b[90m',
  user: '\x1b[34m',
  assistant: '\x1b[30m',
  tool: '\x1b[33m',
  error: '\x1b[31m',
  success: '\x1b[32m',
})

/**
 * Resolve the configured theme.
 * @param name - palette name.
 * @returns the matching theme.
 */
export function themeFor(name: 'dark' | 'light'): Theme {
  return name === 'light' ? light : dark
}
