/**
 * @anago-harness/tui — the terminal application row.
 *
 * The row starts the pi-based UI only after the launcher commits startup, owns
 * stdin through pi-tui's ProcessTerminal, projects durable Session events into
 * the transcript, and answers the approval and user-question waterfalls for the
 * Agent it opened.
 * @module @anago-harness/tui
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query'
import z from '@deepseek-ai/schemastery'
import { TuiApp, describeError } from './app/root.ts'
import { abortAgent, openAgentSession, sendPrompt, type SessionOpenOptions } from './host/agent.ts'
import { projectableSessionEvent, subscribeAgentEvents } from './host/events.ts'
import { registerApprovalWaterfall, registerQuestionsWaterfall } from './host/waterfalls.ts'
import { ProcessTerminal } from './term/pi-tui.ts'
import type { TuiStartupValues } from './startup.ts'

/** Stable Cordis plugin name. */
export const name = 'tui-app'

/** Services this row needs before the terminal can be taken over. */
export const inject = ['agents', 'tuiStartup', 'appReady', 'appExit']

/** Row config; command-line flags override both fields. */
export interface Config {
  /** Palette used when `--theme` is absent. */
  theme: 'dark' | 'light'
  /** Use the main screen when `--inline` is absent. */
  inline: boolean
}

/** Validated config schema. */
export const Config: z<Config> = z.object({
  theme: z.union(['dark', 'light']).default('dark'),
  inline: z.boolean().default(false),
})

/** The one-line refusal shown when stdout cannot host the TUI. */
const NON_TTY_GUIDANCE = 'tui: stdout is not a TTY; the terminal UI needs an interactive terminal. '
  + 'Run `dsh --profile tui` from a terminal, or use `dsh --profile headless "task"` for a non-interactive run.'

/** Mutable facts shared by the boot sequence and the waterfall handlers. */
interface Runtime {
  ui: TuiApp | null
  agent: Agent | null
  handle: AgentHandle | undefined
  removeSignals: () => void
}

/**
 * Install the row.
 *
 * Startup work waits for `ctx.appReady.onReady(...)`, so a tree that fails to
 * mount never takes over the terminal.
 * @param ctx - plugin context.
 * @param config - validated row config.
 */
export function apply(ctx: Context, config: Config): void {
  const ready = ctx.get('appReady')
  const exit = ctx.get('appExit')
  if (ready === undefined || exit === undefined) {
    throw new Error('tui-app: the launcher must provide ctx.appReady and ctx.appExit before the tree mounts')
  }

  const runtime: Runtime = {
    ui: null,
    agent: null,
    handle: undefined,
    removeSignals: () => {},
  }
  let booted = false
  let terminated = false

  const liveUi = (): TuiApp | null => runtime.ui?.isStarted() === true ? runtime.ui : null
  registerApprovalWaterfall(ctx, () => runtime.agent, liveUi)
  registerQuestionsWaterfall(ctx, () => runtime.agent, liveUi)

  const stopUi = (): void => {
    try {
      runtime.ui?.stop()
    } catch (error) {
      process.stderr.write(`tui: failed to restore the terminal: ${describeError(error)}\n`)
    }
  }

  /** @returns whether shutdown or disposal already owns the terminal. */
  const isTerminated = (): boolean => terminated

  /**
   * Enter the termination state once, restore the terminal, release the owned
   * Agent, then run the single exit path. Tree disposal passes `null` because
   * it must invalidate the boot without exiting the process.
   * @param code - exit status to request, or `null` for tree disposal.
   */
  const terminate = async (code: number | null): Promise<void> => {
    if (terminated) return
    terminated = true
    runtime.removeSignals()
    runtime.removeSignals = () => {}
    stopUi()
    runtime.agent = null
    const handle = runtime.handle
    runtime.handle = undefined
    try {
      await handle?.dispose()
    } catch (error) {
      process.stderr.write(`tui: failed to close the Session: ${describeError(error)}\n`)
    }
    if (code !== null) exit(code)
  }

  ctx.effect(() => () => terminate(null))

  ctx.effect(() => ready.onReady(() => {
    if (booted) return
    booted = true
    void boot(ctx, config, terminate, isTerminated, runtime)
  }))
}

/**
 * Open the Session and start the UI.
 *
 * Every await re-checks the shared termination state before the next terminal
 * action, and `ui.start()` is the final step, so a boot that outlives shutdown
 * never acquires the terminal.
 * @param ctx - plugin context.
 * @param config - validated row config.
 * @param shutdown - shared termination state and exit path.
 * @param isTerminated - reads the shared termination state.
 * @param runtime - shared UI, Agent, and termination facts.
 */
async function boot(
  ctx: Context,
  config: Config,
  shutdown: (code: number | null) => Promise<void>,
  isTerminated: () => boolean,
  runtime: Runtime,
): Promise<void> {
  if (isTerminated()) return
  const startup = ctx.get('tuiStartup')
  if (startup === undefined) {
    process.stderr.write('tui: the tui-startup row did not provide tuiStartup; check the profile patch\n')
    await shutdown(1)
    return
  }
  if (!process.stdout.isTTY) {
    process.stderr.write(`${NON_TTY_GUIDANCE}\n`)
    await shutdown(1)
    return
  }
  if (isTerminated()) return

  const onSignal = (): void => {
    void shutdown(0)
  }
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)
  runtime.removeSignals = () => {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
  }

  const ui = new TuiApp({
    terminal: new ProcessTerminal(),
    inline: startup.inline || config.inline,
    theme: startup.theme ?? config.theme,
    onSubmit: (text) => {
      const agent = runtime.agent
      if (agent === null) return
      try {
        sendPrompt(agent, text)
      } catch (error) {
        runtime.ui?.addError(error)
      }
    },
    onAbort: () => {
      const agent = runtime.agent
      if (agent !== null) abortAgent(agent)
    },
    onExit: () => {
      void shutdown(0)
    },
  })
  runtime.ui = ui

  try {
    const opened = await openAgentSession(ctx, openOptionsOf(startup))
    if (isTerminated()) {
      await opened.dispose()
      return
    }
    runtime.handle = opened
    runtime.agent = opened.agent
    ui.setIdentity(identityOf(opened.agent, startup))
    subscribeAgentEvents(ctx, opened.agent, {
      event: (event) => { runtime.ui?.applyEvent(event) },
      delta: (text) => { runtime.ui?.applyDelta(text) },
      status: (status) => { runtime.ui?.setStatus(status) },
      error: (error) => { runtime.ui?.addError(error) },
    })
    if (startup.resume !== null) await replayTranscript(ctx, opened.agent.session.id, ui)
    if (isTerminated()) return
    ui.start()
  } catch (error) {
    if (isTerminated()) return
    process.stderr.write(`tui: ${describeError(error)}\n`)
    await shutdown(1)
  }
}

/**
 * Load the persisted transcript for a resumed Session.
 *
 * A resumed Session's existing events are not republished on `session/event`,
 * so the UI reads the explicit history window through `sessionQuery`; synchronous
 * event-log reads are prohibited for new production callers.
 * @param ctx - plugin context.
 * @param sessionId - the Session that was just resumed.
 * @param ui - renderer receiving the replayed blocks.
 */
async function replayTranscript(ctx: Context, sessionId: SessionId, ui: TuiApp): Promise<void> {
  const query = ctx.get('sessionQuery')
  if (query === undefined) {
    throw new Error('resuming a Session requires the sessionQuery service; mount @deepseek-ai/dsh-session-query in the profile')
  }
  const snapshot = await query.readSession(sessionId)
  for (const event of snapshot.events) {
    const projectable = projectableSessionEvent(event)
    if (projectable !== null) ui.applyEvent(projectable)
  }
}

/**
 * Build the resume/model overrides without materializing absent fields.
 * @param startup - parsed invocation flags.
 * @returns the session-open options for this invocation.
 */
function openOptionsOf(startup: TuiStartupValues): SessionOpenOptions {
  const options: { resume?: string; model?: string; provider?: string } = {}
  if (startup.resume !== null) options.resume = startup.resume
  if (startup.model !== null) options.model = startup.model
  if (startup.provider !== null) options.provider = startup.provider
  return options
}

/**
 * Read the footer identity from the opened Agent.
 * @param agent - the Agent this UI owns.
 * @param startup - invocation overrides, used before the Agent reports them.
 * @returns model, provider, and Session id.
 */
function identityOf(agent: Agent, startup: TuiStartupValues): { model: string; provider: string; sessionId: string } {
  return {
    model: agent.options.model ?? startup.model ?? '',
    provider: agent.options.provider ?? startup.provider ?? '',
    sessionId: String(agent.session.id),
  }
}
