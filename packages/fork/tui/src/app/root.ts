/**
 * Screen composition and input ownership for the terminal UI.
 *
 * This class is the only place that knows about pi-tui components; the DSH
 * service access lives under `host/` and the conversation model under
 * `projection/`. Tests drive it with a fake {@link Terminal}.
 * @module @anago-harness/tui/app/root
 */

import {
  Editor,
  ScrollView,
  TuiAltScreen,
  TuiMainScreen,
  VStack,
  isViewportTUI,
  matchesKey,
  type Component,
  type OverlayHandle,
  type SelectItem,
  type TUI,
  type Terminal,
  type TuiInputListenerResult,
} from '../term/pi-tui.ts'
import {
  addErrorBlock,
  addNoticeBlock,
  applyAssistantDelta,
  applyReasoningDelta,
  applyTranscriptEvent,
  EMPTY_TRANSCRIPT,
  resetTranscript as resetTranscriptState,
  setTranscriptStatus,
  toggleLastExpandable,
  type ProjectableTranscriptEvent,
  type TranscriptState,
} from '../projection/blocks.ts'
import { commandByName, helpText, parseSlashInput, SlashCommandProvider, type ParsedSlashCommand } from './commands.ts'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type { AskUserQuestionAnswer, AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import type { ApprovalPresenter, QuestionsPresenter } from '../host/waterfalls.ts'
import { ChoiceDialog } from './dialogs.ts'
import { PickerDialog } from './picker-dialog.ts'
import {
  modelPickerItems,
  parseModelValue,
  pickerStateOf,
  sessionPickerItems,
  type ModelOption,
  type ModelRoute,
  type PickerItem,
  type SessionOption,
} from './pickers.ts'
import { StatusView, type StatusFields } from './status.ts'
export type { ModelRoute } from './pickers.ts'
import { TranscriptView } from './transcript.ts'
import { themeFor, type Theme } from './theme.ts'

/** How long the first Ctrl+C stays armed. */
const EXIT_CONFIRM_MS = 3_000

/**
 * Host operations the screen needs beyond prompt submission.
 *
 * Enumeration and switching touch DSH services, so they live in the row
 * (`src/index.ts`) and are injected as callbacks; tests omit the host to drive
 * the screen without an Agent.
 */
export interface TuiHost {
  /** List the registered provider/model routes. */
  readonly listModels: () => Promise<readonly ModelOption[]>
  /** Apply one route to the open Agent for its later turns. */
  readonly selectModel: (route: ModelRoute) => Promise<void>
  /** List the profile's stored Sessions, newest first. */
  readonly listSessions: () => Promise<readonly SessionOption[]>
  /**
   * Open a stored Session, or a new one when the id is `null`.
   *
   * Rejects when the Session cannot be opened; the Session the screen already
   * shows then stays open.
   */
  readonly openSession: (sessionId: string | null) => Promise<void>
}

/** Callbacks the DSH row supplies to the screen. */
export interface TuiAppOptions {
  /** Terminal the renderer writes to. */
  readonly terminal: Terminal
  /** Use the main screen instead of the alternate screen. */
  readonly inline: boolean
  /** Palette name. */
  readonly theme: 'dark' | 'light'
  /** Submit one non-empty prompt. */
  readonly onSubmit: (text: string) => void
  /** Abort the running turn. */
  readonly onAbort: () => void
  /** Exit after the screen was restored by the owner. */
  readonly onExit: () => void
  /** DSH-backed operations; omitted by tests that only exercise rendering. */
  readonly host?: TuiHost
}

/** Model, provider, and Session identity shown in the footer. */
export interface AgentIdentity {
  readonly model: string
  readonly provider: string
  readonly sessionId: string
}

/** The terminal application: transcript, status line, editor, and modals. */
export class TuiApp implements ApprovalPresenter, QuestionsPresenter {
  /** The shared renderer interface; its concrete mode follows `inline`. */
  readonly tui: TUI
  private readonly options: TuiAppOptions
  private readonly theme: Theme
  private readonly transcript: TranscriptView
  private readonly status: StatusView
  private readonly editor: Editor
  private readonly host: TuiHost | undefined
  private readonly removeInputListener: () => void
  private state: TranscriptState
  private identity: AgentIdentity = { model: '', provider: '', sessionId: '' }
  private hint = ''
  private exitArmedAt = 0
  private started = false
  private modalPending = false

  /**
   * @param options - terminal, palette, and lifecycle callbacks.
   */
  constructor(options: TuiAppOptions) {
    this.options = options
    this.theme = themeFor(options.theme)
    this.host = options.host
    this.state = EMPTY_TRANSCRIPT
    this.tui = options.inline
      ? new TuiMainScreen(options.terminal)
      : new TuiAltScreen(options.terminal)
    this.transcript = new TranscriptView(this.theme, this.state)
    this.status = new StatusView(this.theme, this.statusFields())
    this.editor = new Editor(this.tui, this.theme.editor, { paddingX: 1 })
    this.editor.setAutocompleteProvider(new SlashCommandProvider())
    this.editor.onSubmit = (text) => { this.submit(text) }
    this.layout()
    this.tui.setFocus(this.editor)
    this.removeInputListener = this.tui.addInputListener(data => this.handleGlobalInput(data))
  }

  /** Compose the renderer layout for its concrete mode. */
  private layout(): void {
    if (isViewportTUI(this.tui)) {
      this.tui.setLayoutRoot(new VStack([
        {
          component: new ScrollView(this.transcript, { follow: 'end', primary: true, overscroll: 'chain' }),
          basis: 0,
          grow: 1,
          minSize: 1,
        },
        {
          component: new VStack([this.status, this.editor]),
          basis: 'auto',
          shrink: 1,
          minSize: 1,
        },
      ]))
      return
    }
    for (const child of [this.transcript, this.status, this.editor] satisfies Component[]) {
      this.tui.addChild(child)
    }
  }

  /**
   * Current transcript projection, for tests and for a caller that needs to
   * assert the rendered blocks.
   * @returns the current projection state.
   */
  getTranscriptState(): TranscriptState {
    return this.state
  }

  /**
   * Current footer facts, for tests.
   * @returns the facts the footer renders.
   */
  getStatusFields(): StatusFields {
    return this.status.getFields()
  }

  /**
   * The prompt editor, so an input test can drive it directly.
   * @returns the editor component owned by this app.
   */
  getEditor(): Editor {
    return this.editor
  }

  /**
   * Whether the renderer currently owns the terminal.
   * @returns true between start and stop.
   */
  isStarted(): boolean {
    return this.started
  }

  /**
   * Point the footer at the open Agent.
   * @param identity - model, provider, and Session id.
   */
  setIdentity(identity: AgentIdentity): void {
    this.identity = identity
    this.syncStatus()
    this.requestFrame()
  }

  /**
   * Fold one durable Session event into the transcript.
   * @param event - projectable event.
   */
  applyEvent(event: ProjectableTranscriptEvent): void {
    const next = applyTranscriptEvent(this.state, event)
    if (next === this.state) return
    this.state = next
    this.paint()
  }

  /**
   * Append streamed assistant text.
   * @param text - delta text.
   */
  applyDelta(text: string): void {
    const next = applyAssistantDelta(this.state, text)
    if (next === this.state) return
    this.state = next
    this.paint()
  }

  /**
   * Append streamed reasoning text.
   * @param text - delta text.
   */
  applyReasoning(text: string): void {
    const next = applyReasoningDelta(this.state, text)
    if (next === this.state) return
    this.state = next
    this.paint()
  }

  /** Clear the displayed conversation before another Session's replay starts. */
  resetTranscript(): void {
    this.state = resetTranscriptState()
    this.paint()
  }

  /**
   * Replace the lifecycle state shown in the footer.
   * @param status - lifecycle state.
   */
  setStatus(status: 'idle' | 'running'): void {
    const next = setTranscriptStatus(this.state, status)
    if (next !== this.state) this.state = next
    if (status === 'idle' && this.hint === 'aborting…') this.hint = ''
    this.syncStatus()
    this.requestFrame()
  }

  /**
   * Append an error row.
   * @param error - failure value from the Agent.
   */
  addError(error: unknown): void {
    this.state = addErrorBlock(this.state, describeError(error))
    this.state = setTranscriptStatus(this.state, 'idle')
    this.paint()
  }

  /**
   * Append an informational notice.
   * @param text - notice text.
   */
  addNotice(text: string): void {
    this.state = addNoticeBlock(this.state, text)
    this.paint()
  }

  /**
   * Start the renderer and take ownership of stdin raw mode.
   *
   * The owner must call {@link stop} on every exit path.
   */
  start(): void {
    if (this.started) return
    this.started = true
    this.tui.start()
  }

  /** Restore the screen and terminal state. Safe to call twice. */
  stop(): void {
    if (!this.started) return
    this.started = false
    this.removeInputListener()
    this.tui.stop()
  }

  /**
   * Render one frame synchronously; used by the owner after replay and by tests.
   */
  renderNow(): void {
    this.tui.renderNow(true)
  }

  /**
   * Ask for an approval decision.
   * @param request - pending approval request.
   * @returns `allowed-once` or `rejected`; Escape denies.
   */
  async askApproval(request: ApprovalRequest): Promise<ApprovalOutcome> {
    const detail = request.reason ?? request.displayReason?.en
    const value = await this.choose({
      title: `Approve ${request.toolName}?`,
      detail,
      items: [
        { value: 'allowed-once', label: 'Allow once', description: 'run this one operation' },
        { value: 'rejected', label: 'Deny', description: 'refuse this operation' },
      ],
      hint: 'Enter select · Esc deny',
    })
    return value === 'allowed-once' ? 'allowed-once' : 'rejected'
  }

  /**
   * Ask the human to answer a question batch.
   *
   * A question with no offered options is not handled here, so the waterfall
   * delegates rather than inventing an answer.
   * @param request - pending question batch.
   * @returns the structured answer, or `null` to delegate.
   */
  async askQuestions(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer | null> {
    const answers: AskUserQuestionAnswer['answers'] = []
    for (const question of request.questions) {
      if (question.options === undefined || question.options.length === 0) return null
      const detail = [question.question, question.detail].filter(value => value !== undefined && value !== '').join('\n\n')
      const selected = await this.choose({
        title: question.header ?? 'Question',
        detail,
        items: question.options.map(option => ({
          value: option.label,
          label: option.label,
          ...option.description === undefined ? {} : { description: option.description },
        })),
        hint: 'Enter select · Esc defer',
      })
      if (selected === null) return null
      answers.push({ id: question.id, selected: [selected] })
    }
    return { answers }
  }

  /**
   * Show one modal list and wait for its outcome.
   * @param options - title, detail, rows, and hint.
   * @returns the selected value, or `null` on Escape.
   */
  private choose(options: {
    title: string
    detail: string | undefined
    items: readonly SelectItem[]
    hint: string
  }): Promise<string | null> {
    return this.openDialog((finish, cancel) => new ChoiceDialog({
      ...options,
      onChoose: finish,
      onCancel: cancel,
    }, this.theme))
  }

  /**
   * Show one overlay and wait for its choice.
   * @param build - creates the component from the settle callbacks.
   * @returns the chosen value, or `null` on Escape.
   */
  private openDialog<T>(
    build: (choose: (value: T) => void, cancel: () => void) => Component,
  ): Promise<T | null> {
    return new Promise((resolve, reject) => {
      let handle: OverlayHandle | undefined
      const finish = (value: T | null): void => {
        handle?.hide()
        this.requestFrame()
        resolve(value)
      }
      try {
        const dialog = build((value) => { finish(value) }, () => { finish(null) })
        handle = this.tui.showOverlay(dialog, {
          width: Math.max(12, Math.min(76, this.tui.terminal.columns - 2)),
          maxHeight: '70%',
          margin: 1,
        })
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  /**
   * Open the model selector and apply the chosen route.
   *
   * The Agent keeps running; the new route applies to its next prompt assembly
   * or step, so no restart is needed.
   * @returns fulfillment after the dialog closes or the choice is applied.
   */
  async openModelPicker(): Promise<void> {
    try {
      await this.withModal(() => this.pickModel())
    } catch (error) {
      this.addError(error)
    }
  }

  /**
   * Open the stored-Session selector and resume the chosen Session.
   * @returns fulfillment after the dialog closes or the switch requests an open.
   */
  async openSessionPicker(): Promise<void> {
    try {
      await this.withModal(() => this.pickSession())
    } catch (error) {
      this.addError(error)
    }
  }

  /**
   * Run one modal operation unless another dialog is already opening or open.
   * @param task - operation that shows and settles the dialog.
   * @returns fulfillment after the operation settles.
   */
  private async withModal(task: () => Promise<void>): Promise<void> {
    if (this.modalPending || this.tui.hasOverlay()) return
    this.modalPending = true
    try {
      await task()
    } finally {
      this.modalPending = false
    }
  }

  /**
   * Enumerate routes and apply the chosen model.
   * @returns fulfillment after the dialog closes or the choice is applied.
   */
  private async pickModel(): Promise<void> {
    const host = this.host
    if (host === undefined) {
      this.addNotice('model selection is unavailable in this build')
      return
    }
    let options: readonly ModelOption[]
    try {
      options = await host.listModels()
    } catch (error) {
      this.addError(error)
      return
    }
    if (options.length === 0) {
      this.addNotice('no registered model routes')
      return
    }
    const selected = await this.openDialog<PickerItem>((finish, cancel) => new PickerDialog({
      title: 'Model',
      detail: 'Registered provider routes from the Host LLM service.',
      hint: '↑↓ move · Enter select · Esc close · type to filter',
      state: pickerStateOf(modelPickerItems(options)),
      onChoose: finish,
      onCancel: cancel,
    }, this.theme))
    if (selected === null) return
    const route = parseModelValue(selected.value)
    if (route === undefined) {
      this.addError(new Error('the model picker produced an unknown route'))
      return
    }
    try {
      await host.selectModel(route)
      this.addNotice(`model → ${route.provider} · ${route.model}`)
    } catch (error) {
      this.addError(error)
    }
  }

  /**
   * Enumerate Sessions and resume the chosen one.
   * @returns fulfillment after the dialog closes or the switch requests an open.
   */
  private async pickSession(): Promise<void> {
    const host = this.host
    if (host === undefined) {
      this.addNotice('Session switching is unavailable in this build')
      return
    }
    let options: readonly SessionOption[]
    try {
      options = await host.listSessions()
    } catch (error) {
      this.addError(error)
      return
    }
    if (options.length === 0) {
      this.addNotice('no stored Sessions')
      return
    }
    const selected = await this.openDialog<PickerItem>((finish, cancel) => new PickerDialog({
      title: 'Resume a Session',
      detail: `${String(options.length)} stored Session${options.length === 1 ? '' : 's'} in this profile.`,
      hint: '↑↓ move · Enter open · Esc close · type to filter',
      state: pickerStateOf(sessionPickerItems(options, Date.now())),
      onChoose: finish,
      onCancel: cancel,
    }, this.theme))
    if (selected === null) return
    try {
      await host.openSession(selected.value)
      this.addNotice(`resumed Session ${selected.value.slice(0, 8)}`)
    } catch (error) {
      this.addError(error)
    }
  }

  /**
   * Start a new Session, or clear the view when no host is attached.
   */
  private async clearSession(): Promise<void> {
    const host = this.host
    if (host === undefined) {
      this.resetTranscript()
      this.addNotice('cleared the transcript')
      return
    }
    try {
      await host.openSession(null)
      this.addNotice('started a new Session')
    } catch (error) {
      this.addError(error)
    }
  }

  /**
   * Run one parsed slash command.
   * @param command - parsed command and its arguments.
   */
  private runCommand(command: ParsedSlashCommand): void {
    if (commandByName(command.name) === undefined) {
      this.addNotice(`unknown command /${command.name} · type /help for the command list`)
      return
    }
    switch (command.name) {
      case 'help':
        this.addNotice(helpText())
        return
      case 'model':
        void this.openModelPicker()
        return
      case 'clear':
        void this.clearSession()
        return
      case 'resume':
        void this.openSessionPicker()
        return
      case 'quit':
        this.options.onExit()
        return
    }
  }

  /**
   * Apply global keys before the focused component sees them.
   * @param data - raw terminal input.
   * @returns the consumption instruction.
   */
  private handleGlobalInput(data: string): TuiInputListenerResult {
    if (matchesKey(data, 'ctrl+c')) {
      const now = Date.now()
      if (this.exitArmedAt !== 0 && now - this.exitArmedAt <= EXIT_CONFIRM_MS) {
        this.exitArmedAt = 0
        this.options.onExit()
        return { consume: true }
      }
      this.exitArmedAt = now
      this.hint = 'Ctrl+C again to quit'
      this.syncStatus()
      this.requestFrame()
      return { consume: true }
    }
    if (this.tui.hasOverlay()) return undefined
    if (matchesKey(data, 'ctrl+p')) {
      void this.openModelPicker()
      return { consume: true }
    }
    if (matchesKey(data, 'ctrl+r')) {
      void this.openSessionPicker()
      return { consume: true }
    }
    if (matchesKey(data, 'ctrl+o')) {
      const next = toggleLastExpandable(this.state)
      if (next === this.state) return undefined
      this.state = next
      this.paint()
      return { consume: true }
    }
    if (!matchesKey(data, 'escape')) return undefined
    if (this.exitArmedAt !== 0) {
      this.exitArmedAt = 0
      this.hint = ''
      this.syncStatus()
      this.requestFrame()
      return { consume: true }
    }
    if (this.state.status === 'running') {
      this.options.onAbort()
      this.hint = 'aborting…'
      this.syncStatus()
      this.requestFrame()
      return { consume: true }
    }
    return undefined
  }

  /**
   * Submit editor text: run a slash command, or send an ordinary prompt.
   * @param text - editor text.
   */
  private submit(text: string): void {
    const trimmed = text.trim()
    if (trimmed === '') return
    this.editor.addToHistory(text)
    const command = parseSlashInput(trimmed)
    if (command !== undefined) {
      this.runCommand(command)
      return
    }
    this.setStatus('running')
    try {
      this.options.onSubmit(text)
    } catch (error) {
      this.addError(error)
    }
  }

  /** Push the current state into the child components and request a frame. */
  private paint(): void {
    this.transcript.setState(this.state)
    this.syncStatus()
    this.requestFrame()
  }

  /** Request a frame only while the renderer owns the terminal. */
  private requestFrame(): void {
    if (this.started) this.tui.requestRender()
  }

  /** Rebuild the footer facts from the transcript state. */
  private syncStatus(): void {
    this.status.setFields(this.statusFields())
  }

  /** @returns the footer facts derived from state and identity. */
  private statusFields(): StatusFields {
    return {
      model: this.identity.model,
      provider: this.identity.provider,
      sessionId: this.identity.sessionId,
      status: this.state.status,
      hint: this.hint,
      usage: this.state.usage,
    }
  }
}

/**
 * Turn an arbitrary failure into one display line.
 * @param error - thrown or reported value.
 * @returns a human-readable message.
 */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch (serializationError) {
    // Cyclic or otherwise non-serializable failures still need a visible line.
    if (!(serializationError instanceof TypeError)) throw serializationError
    return String(error)
  }
}
