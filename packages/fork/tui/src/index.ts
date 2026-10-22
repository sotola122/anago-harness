/**
 * @anago-harness/tui — the terminal application row.
 *
 * The row starts the pi-based UI only after the launcher commits startup, owns
 * stdin through pi-tui's ProcessTerminal, projects durable Session events into
 * the transcript, answers the approval and user-question waterfalls for the
 * Agent it opened, and serves the screen's model and Session pickers from the
 * Host services.
 * @module @anago-harness/tui
 */

import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection, type Agent, type AgentHandle, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query'
import z from '@deepseek-ai/schemastery'
import { TuiApp, describeError, type AgentIdentity, type ModelRoute, type TuiHost } from './app/root.ts'
import type { ModelOption, SessionOption } from './app/pickers.ts'
import {
  abortAgent,
  openAgentSession,
  sendPrompt,
  type AgentRoute,
  type SessionOpenOptions,
} from './host/agent.ts'
import { projectableSessionEvent, subscribeAgentEvents } from './host/events.ts'
import { listModelOptions, resolveModelRoute } from './host/models.ts'
import { listSessionOptions } from './host/sessions.ts'
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

/** Mutable facts shared by the boot sequence, the pickers, and the waterfall handlers. */
interface Runtime {
  ui: TuiApp | null
  agent: Agent | null
  handle: AgentHandle | undefined
  selection: ModelSelectionRef | null
  removeEvents: () => void
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
    selection: null,
    removeEvents: () => {},
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
    runtime.removeEvents()
    runtime.removeEvents = () => {}
    stopUi()
    runtime.agent = null
    runtime.selection = null
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

  /** Serialize Session switches so a second pick cannot interleave disposal. */
  let sessionTail: Promise<void> = Promise.resolve()
  const queueSession = (task: () => Promise<void>): Promise<void> => {
    const run = sessionTail.then(task, task)
    sessionTail = run.then(() => undefined, () => undefined)
    return run
  }

  const ui = new TuiApp({
    terminal: new ProcessTerminal(),
    inline: startup.inline || config.inline,
    theme: startup.theme ?? config.theme,
    onSubmit: (text) => {
      const agent = runtime.agent
      if (agent === null) throw new Error('no Agent is open yet')
      sendPrompt(agent, text)
    },
    onAbort: () => {
      const agent = runtime.agent
      if (agent !== null) abortAgent(agent)
    },
    onExit: () => {
      void shutdown(0)
    },
    host: hostFor(ctx, runtime, queueSession, isTerminated, startup),
  })
  runtime.ui = ui

  try {
    await openInto(ctx, runtime, ui, openOptionsOf(startup), isTerminated)
    if (isTerminated()) return
    ui.start()
  } catch (error) {
    if (isTerminated()) return
    process.stderr.write(`tui: ${describeError(error)}\n`)
    await shutdown(1)
  }
}

/**
 * Build the screen's DSH-backed operations.
 *
 * Model routes come from the Host LLM catalog and are installed on the live
 * Agent through its model-selection listeners, so a switch applies to later
 * turns without recreating the Agent. Session pages are opened by disposing the
 * current Agent and resuming or creating another in the same terminal.
 * @param ctx - plugin context.
 * @param runtime - shared UI, Agent, and selection facts.
 * @param queueSession - serializes Session switches.
 * @param isTerminated - reads the shared termination state.
 * @param startup - invocation flags supplying the initial route.
 * @returns the host callbacks.
 */
function hostFor(
  ctx: Context,
  runtime: Runtime,
  queueSession: (task: () => Promise<void>) => Promise<void>,
  isTerminated: () => boolean,
  startup: TuiStartupValues,
): TuiHost {
  const screen = (): TuiApp => {
    const app = runtime.ui
    if (app === null) throw new Error('the terminal UI is not ready')
    return app
  }
  const currentRoute = (): ModelRoute | undefined => {
    const route = runtime.selection?.current
    if (route !== undefined) return { provider: route.provider, model: route.model }
    if (startup.provider !== null && startup.model !== null) {
      return { provider: startup.provider, model: startup.model }
    }
    return undefined
  }

  return {
    listModels: (): Promise<readonly ModelOption[]> => listModelOptions(ctx, currentRoute()),
    selectModel: async (route) => {
      const agent = runtime.agent
      const selection = runtime.selection
      if (agent === null || selection === null) throw new Error('no Agent is open yet')
      const resolved = await resolveModelRoute(ctx, route)
      selection.current = resolved
      screen().setIdentity(identityOf(agent, resolved))
    },
    listSessions: (): Promise<readonly SessionOption[]> => listSessionOptions(
      ctx,
      runtime.agent === null ? undefined : String(runtime.agent.session.id),
    ),
    openSession: async (sessionId) => {
      const route = currentRoute()
      const options: SessionOpenOptions = {
        ...sessionId === null ? {} : { resume: sessionId },
        ...route === undefined ? {} : { provider: route.provider, model: route.model },
      }
      await queueSession(() => openInto(ctx, runtime, screen(), options, isTerminated))
    },
  }
}

/**
 * Detach the current Agent and attach the requested Session.
 *
 * The previous handle is disposed before the new one is opened, and the
 * termination state is re-checked after every await so a shutdown during an
 * open leaves no Agent behind.
 * @param ctx - plugin context.
 * @param runtime - shared UI, Agent, and selection facts.
 * @param ui - the screen to repaint.
 * @param options - resume and model overrides for the new Session.
 * @param isTerminated - reads the shared termination state.
 */
async function openInto(
  ctx: Context,
  runtime: Runtime,
  ui: TuiApp,
  options: SessionOpenOptions,
  isTerminated: () => boolean,
): Promise<void> {
  runtime.removeEvents()
  runtime.removeEvents = () => {}
  const previous = runtime.handle
  runtime.handle = undefined
  runtime.agent = null
  runtime.selection = null
  try {
    await previous?.dispose()
  } catch (error) {
    process.stderr.write(`tui: failed to close the previous Session: ${describeError(error)}\n`)
  }
  if (isTerminated()) return

  const opened = await openAgentSession(ctx, options)
  if (isTerminated()) {
    await opened.handle.dispose()
    return
  }
  const selection: ModelSelectionRef = { current: opened.route, assembled: undefined }
  installModelSelection(opened.handle.agent.ctx, selection)
  runtime.handle = opened.handle
  runtime.agent = opened.handle.agent
  runtime.selection = selection
  runtime.removeEvents = subscribeAgentEvents(ctx, opened.handle.agent, {
    event: (event) => { runtime.ui?.applyEvent(event) },
    delta: (text) => { runtime.ui?.applyDelta(text) },
    reasoning: (text) => { runtime.ui?.applyReasoning(text) },
    status: (status) => { runtime.ui?.setStatus(status) },
    error: (error) => { runtime.ui?.addError(error) },
  })
  ui.resetTranscript()
  if (options.resume !== undefined && options.resume !== '') {
    await replayTranscript(ctx, opened.handle.agent.session.id, ui)
  }
  ui.setIdentity(identityOf(opened.handle.agent, opened.route))
  ui.setStatus('idle')
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
 * Read the footer identity from the opened Agent and its selection.
 * @param agent - the Agent this UI owns.
 * @param route - the route the Agent uses, when one is resolved.
 * @returns model, provider, and Session id.
 */
function identityOf(agent: Agent, route: AgentRoute | undefined): AgentIdentity {
  return {
    model: route?.model ?? agent.options.model ?? '',
    provider: route?.provider ?? agent.options.provider ?? '',
    sessionId: String(agent.session.id),
  }
}
