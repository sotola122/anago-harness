/**
 * The TUI app's command-line provider: it parses `dsh --profile tui` flags and
 * publishes the immutable values as {@link TUI_STARTUP_SERVICE}.
 * @module @anago-harness/tui/startup
 */

import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'
import { Command } from './term/commander.ts'

/** Stable Cordis plugin name. */
export const name = 'tui-startup'

/** Services required before the flags can be resolved. */
export const inject = ['cmdlineArgs']

/** Service provided by this row and injected by the app row. */
export const TUI_STARTUP_SERVICE = 'tuiStartup'

/** Palettes the command line accepts. */
export type TuiThemeName = 'dark' | 'light'

/** What the app row reads from {@link TUI_STARTUP_SERVICE}. */
export interface TuiStartupValues {
  /** Persisted Session id to resume, or `null` for a fresh Session. */
  readonly resume: string | null
  /** Model id override, or `null` when the composition decides. */
  readonly model: string | null
  /** Provider route override, or `null` when the composition decides. */
  readonly provider: string | null
  /** Palette override, or `null` to use the row config. */
  readonly theme: TuiThemeName | null
  /** Use the main screen instead of the alternate screen. */
  readonly inline: boolean
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Flags of this invocation; absent when the startup row did not activate. */
    tuiStartup?: TuiStartupValues
  }
}

/**
 * This app's command: its flags, description, and help text.
 * @returns a fresh program, so one process can parse more than once.
 */
function tuiCommand(): Command {
  return new Command()
    .name('dsh --profile tui')
    .description('Boot the DeepSeek Harness terminal UI.')
    .helpOption('-h, --help', 'show this help')
    .option('--resume <sessionId>', 'resume a persisted Session by id')
    .option('--model <modelId>', 'model id for the new or resumed Agent')
    .option('--provider <provider>', 'provider route for the new or resumed Agent')
    .option('--theme <theme>', 'palette: dark or light')
    .option('--inline', 'render into the main screen instead of the alternate screen')
    .addHelpText('after', `
Examples:
  dsh --profile tui                        start a fresh Session
  dsh --profile tui --resume <id>          resume a persisted Session
  dsh --profile tui --theme light          use the light palette
  dsh --profile tui --inline               keep the terminal scrollback
`)
}

/**
 * Parse this invocation and provide the startup values as an ordinary Cordis
 * service. `--help` and usage errors provide no service.
 * @param ctx - plugin context carrying the command line and bounded exit.
 */
export function apply(ctx: Context): void {
  const program = tuiCommand()
  program.action(() => {
    const options = program.opts<{
      resume?: string
      model?: string
      provider?: string
      theme?: string
      inline?: boolean
    }>()
    if (options.resume !== undefined && options.resume.trim() === '') {
      program.error('error: --resume requires a non-empty Session id')
    }
    if (options.theme !== undefined && options.theme !== 'dark' && options.theme !== 'light') {
      program.error(`error: --theme must be "dark" or "light", got ${JSON.stringify(options.theme)}`)
    }
    const theme: TuiThemeName | null = options.theme === 'dark' || options.theme === 'light' ? options.theme : null
    ctx.provide(TUI_STARTUP_SERVICE, {
      resume: options.resume ?? null,
      model: options.model ?? null,
      provider: options.provider ?? null,
      theme,
      inline: options.inline === true,
    } satisfies TuiStartupValues)
  })
  parseCmdline(ctx, program)
}
