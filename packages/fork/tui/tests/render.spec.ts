import { describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { TuiApp } from '../src/app/root.ts'
import { visibleWidth } from '../src/term/pi-tui.ts'
import type { ProjectableTranscriptEvent } from '../src/projection/blocks.ts'
import type { ModelOption, SessionOption } from '../src/app/pickers.ts'
import { FakeTerminal } from './support/fake-terminal.ts'

/**
 * Build one user message event.
 * @param seq - durable sequence number.
 * @param text - message text.
 * @returns the event.
 */
function user(seq: number, text: string): ProjectableTranscriptEvent {
  return {
    type: 'user/message',
    seq,
    time: 1,
    data: { content: [{ type: 'text', text }], source: { kind: 'user' } },
  }
}

/**
 * Build the approval request payload.
 * @returns a request body with only the fields the dialog reads.
 */
function approvalRequest(): Parameters<TuiApp['askApproval']>[0] {
  return {
    agent: { id: SessionId('agent-1') } as Parameters<TuiApp['askApproval']>[0]['agent'],
    toolName: 'bash',
    reason: 'The tool wants to write build output.',
  }
}

describe('TUI rendering', () => {
  it('renders a representative frame with transcript, tools, status, and editor', () => {
    const terminal = new FakeTerminal()
    const app = new TuiApp({
      terminal,
      inline: true,
      theme: 'dark',
      onSubmit: () => {},
      onAbort: () => {},
      onExit: () => {},
    })
    app.applyEvent(user(0, 'please list the files'))
    app.applyDelta('Here are the files')
    app.applyEvent({
      type: 'tool/call',
      seq: 1,
      time: 1,
      data: { callId: 'call-1', name: 'bash', arguments: JSON.stringify({ command: 'ls -la' }) },
    })
    app.applyEvent({
      type: 'tool/result',
      seq: 2,
      time: 1,
      data: { message: { content: [{ type: 'text', text: 'a.txt\nb.txt' }], source: { callId: 'call-1' } } },
    })
    app.setIdentity({ model: 'deepseek-v4', provider: 'deepseek', sessionId: '0123456789abcdef' })
    app.setStatus('running')

    app.renderNow()

    const lines = terminal.visibleLines()
    const frame = lines.join('\n')
    expect(frame).toContain('please list the files')
    expect(frame).toContain('Here are the files')
    expect(frame).toContain('bash')
    expect(frame).toContain('ls -la')
    expect(frame).toContain('a.txt')
    expect(frame).toContain('deepseek · deepseek-v4')
    expect(frame).toContain('running')
    expect(frame).toContain('01234567')
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(terminal.columns)
  })

  it('chooses the renderer the invocation asked for', () => {
    const make = (inline: boolean): TuiApp => new TuiApp({
      terminal: new FakeTerminal(),
      inline,
      theme: 'dark',
      onSubmit: () => {},
      onAbort: () => {},
      onExit: () => {},
    })
    expect(make(true).tui.mode).toBe('regular')
    expect(make(false).tui.mode).toBe('fullscreen')
  })

  it('answers an approval modal with the selected outcome', async () => {
    const terminal = new FakeTerminal()
    const app = new TuiApp({
      terminal,
      inline: true,
      theme: 'dark',
      onSubmit: () => {},
      onAbort: () => {},
      onExit: () => {},
    })
    app.start()
    const decision = app.askApproval(approvalRequest())
    app.renderNow()
    expect(terminal.visibleLines().join('\n')).toContain('Approve bash?')
    expect(terminal.visibleLines().join('\n')).toContain('Allow once')
    terminal.send('\r')
    await expect(decision).resolves.toBe('allowed-once')
    app.stop()
  })

  it('answers a question modal over a SelectList and defers on Escape', async () => {
    const terminal = new FakeTerminal()
    const app = new TuiApp({
      terminal,
      inline: true,
      theme: 'dark',
      onSubmit: () => {},
      onAbort: () => {},
      onExit: () => {},
    })
    app.start()

    const answered = app.askQuestions({
      questions: [{
        id: 'q1',
        header: 'Proceed',
        question: 'Continue with the migration?',
        options: [{ label: 'Yes' }, { label: 'No' }],
      }],
    })
    app.renderNow()
    expect(terminal.visibleLines().join('\n')).toContain('Continue with the migration?')
    terminal.send('\r')
    await expect(answered).resolves.toEqual({ answers: [{ id: 'q1', selected: ['Yes'] }] })

    const deferred = app.askQuestions({
      questions: [{ id: 'q2', question: 'Free text?', options: [{ label: 'A' }] }],
    })
    app.renderNow()
    terminal.send('\x1b')
    await expect(deferred).resolves.toBeNull()
    app.stop()
  })

  it('submits editor text and aborts a running turn on Escape', () => {
    const terminal = new FakeTerminal()
    const submitted: string[] = []
    const aborted = vi.fn()
    const app = new TuiApp({
      terminal,
      inline: true,
      theme: 'dark',
      onSubmit: (text) => { submitted.push(text) },
      onAbort: aborted,
      onExit: () => {},
    })
    app.start()
    app.getEditor().setText('run the tests')
    terminal.send('\r')
    expect(submitted).toEqual(['run the tests'])
    expect(app.getStatusFields().status).toBe('running')

    terminal.send('\x1b')
    expect(aborted).toHaveBeenCalledTimes(1)
    expect(app.getStatusFields().hint).toBe('aborting…')
    app.stop()
  })

  it('asks before exiting on Ctrl+C and exits on the second press', () => {
    const terminal = new FakeTerminal()
    const exited = vi.fn()
    const app = new TuiApp({
      terminal,
      inline: true,
      theme: 'dark',
      onSubmit: () => {},
      onAbort: () => {},
      onExit: exited,
    })
    app.start()
    terminal.send('\x03')
    expect(exited).not.toHaveBeenCalled()
    expect(app.getStatusFields().hint).toContain('Ctrl+C again')
    terminal.send('\x03')
    expect(exited).toHaveBeenCalledTimes(1)
    app.stop()
  })

  it('restores the terminal when the renderer stops', () => {
    const terminal = new FakeTerminal()
    const app = new TuiApp({
      terminal,
      inline: true,
      theme: 'dark',
      onSubmit: () => {},
      onAbort: () => {},
      onExit: () => {},
    })
    app.start()
    expect(terminal.started).toBe(true)
    app.stop()
    expect(terminal.started).toBe(false)
  })

  it('renders reasoning collapsed and a per-turn usage footer', () => {
    const terminal = new FakeTerminal()
    const app = new TuiApp({
      terminal,
      inline: true,
      theme: 'dark',
      onSubmit: () => {},
      onAbort: () => {},
      onExit: () => {},
    })
    app.start()
    app.applyEvent({ type: 'turn/start', seq: 0, time: 1 })
    app.applyEvent({
      type: 'assistant/message',
      seq: 1,
      time: 2,
      data: {
        message: {
          content: [
            { type: 'reasoning', text: 'First thought\nSecond thought' },
            { type: 'text', text: 'The answer.' },
          ],
        },
        usage: { inputTokens: 1_200, outputTokens: 300 },
      },
    })
    app.setIdentity({ model: 'deepseek-v4', provider: 'deepseek', sessionId: '0123456789abcdef' })
    app.renderNow()

    const frame = terminal.visibleLines().join('\n')
    expect(frame).toContain('◇ reasoning')
    expect(frame).toContain('First thought')
    expect(frame).not.toContain('Second thought')
    expect(frame).toContain('in 1.2k · out 300')

    terminal.send('\x0f')
    app.renderNow()
    expect(terminal.visibleLines().join('\n')).toContain('Second thought')
    app.stop()
  })

  it('expands the newest tool result and shows its duration', () => {
    const terminal = new FakeTerminal()
    const app = new TuiApp({
      terminal,
      inline: true,
      theme: 'dark',
      onSubmit: () => {},
      onAbort: () => {},
      onExit: () => {},
    })
    app.start()
    app.applyEvent({
      type: 'tool/call',
      seq: 0,
      time: 1_000,
      data: { callId: 'call-1', name: 'bash', arguments: JSON.stringify({ command: 'printf' }) },
    })
    app.applyEvent({
      type: 'tool/result',
      seq: 1,
      time: 1_250,
      data: {
        message: { content: [{ type: 'text', text: 'first line\nsecond line' }], source: { callId: 'call-1' } },
        meta: { cwd: '/repo' },
      },
    })
    app.renderNow()
    expect(terminal.visibleLines().join('\n')).toContain('first line')
    expect(terminal.visibleLines().join('\n')).not.toContain('second line')
    expect(terminal.visibleLines().join('\n')).toContain('250ms')

    terminal.send('\x0f')
    app.renderNow()
    expect(terminal.visibleLines().join('\n')).toContain('second line')
    app.stop()
  })

  it('runs /help and /quit without dispatching a prompt', () => {
    const terminal = new FakeTerminal()
    const submitted: string[] = []
    const exited = vi.fn()
    const app = new TuiApp({
      terminal,
      inline: true,
      theme: 'dark',
      onSubmit: (text) => { submitted.push(text) },
      onAbort: () => {},
      onExit: exited,
    })
    app.start()
    app.getEditor().setText('/help')
    terminal.send('\r')
    app.renderNow()
    const frame = terminal.visibleLines().join('\n')
    expect(frame).toContain('Commands')
    expect(frame).toContain('/model')
    expect(frame).toContain('Ctrl+O')
    expect(app.getStatusFields().status).toBe('idle')
    expect(submitted).toEqual([])

    app.getEditor().setText('/quit')
    terminal.send('\r')
    expect(exited).toHaveBeenCalledTimes(1)
    expect(submitted).toEqual([])
    app.stop()
  })

  it('opens the slash-command completion popup as the editor is typed', async () => {
    const terminal = new FakeTerminal()
    const app = new TuiApp({
      terminal,
      inline: true,
      theme: 'dark',
      onSubmit: () => {},
      onAbort: () => {},
      onExit: () => {},
    })
    app.start()
    terminal.send('/')
    await flush()
    app.renderNow()
    const frame = terminal.visibleLines().join('\n')
    expect(frame).toContain('help')
    expect(frame).toContain('choose the provider and model for later turns')
    app.stop()
  })

  it('opens the model picker with Ctrl+P and applies the chosen route', async () => {
    const terminal = new FakeTerminal()
    const models: readonly ModelOption[] = [
      { provider: 'deepseek', model: 'deepseek-v4', label: 'DeepSeek V4', current: true },
      { provider: 'deepseek', model: 'deepseek-flash', label: 'DeepSeek Flash', current: false },
    ]
    const selectModel = vi.fn(async () => {})
    const app = new TuiApp({
      terminal,
      inline: true,
      theme: 'dark',
      onSubmit: () => {},
      onAbort: () => {},
      onExit: () => {},
      host: {
        listModels: async () => models,
        selectModel,
        listSessions: async () => [],
        openSession: async () => {},
      },
    })
    app.start()
    terminal.send('\x10')
    await flush()
    app.renderNow()
    const frame = terminal.visibleLines().join('\n')
    expect(frame).toContain('Model')
    expect(frame).toContain('DeepSeek V4 (current)')
    expect(frame).toContain('DeepSeek Flash')

    terminal.reset()
    for (const character of 'flash') terminal.send(character)
    await flush()
    app.renderNow()
    const filtered = terminal.visibleLines().join('\n')
    expect(filtered).toContain('DeepSeek Flash')
    expect(filtered).not.toContain('DeepSeek V4')

    terminal.send('\r')
    await flush()
    expect(selectModel).toHaveBeenCalledTimes(1)
    expect(selectModel).toHaveBeenCalledWith({ provider: 'deepseek', model: 'deepseek-flash' })
    app.renderNow()
    expect(terminal.visibleLines().join('\n')).toContain('model → deepseek · deepseek-flash')
    app.stop()
  })

  it('opens the Session picker and resumes the chosen Session', async () => {
    const terminal = new FakeTerminal()
    const sessions: readonly SessionOption[] = [
      { id: 'session-42', createdAt: Date.now() - 60_000, cwd: '/repo/anago', current: false },
    ]
    const openSession = vi.fn(async () => {})
    const app = new TuiApp({
      terminal,
      inline: true,
      theme: 'dark',
      onSubmit: () => {},
      onAbort: () => {},
      onExit: () => {},
      host: {
        listModels: async () => [],
        selectModel: async () => {},
        listSessions: async () => sessions,
        openSession,
      },
    })
    app.start()
    void app.openSessionPicker()
    await flush()
    app.renderNow()
    expect(terminal.visibleLines().join('\n')).toContain('Resume a Session')
    expect(terminal.visibleLines().join('\n')).toContain('anago')

    terminal.send('\r')
    await flush()
    expect(openSession).toHaveBeenCalledWith('session-42')
    app.stop()
  })

  it('/clear asks the host for a new Session, and clears the view without a host', async () => {
    const terminal = new FakeTerminal()
    const openSession = vi.fn(async () => {})
    const app = new TuiApp({
      terminal,
      inline: true,
      theme: 'dark',
      onSubmit: () => {},
      onAbort: () => {},
      onExit: () => {},
      host: {
        listModels: async () => [],
        selectModel: async () => {},
        listSessions: async () => [],
        openSession,
      },
    })
    app.start()
    app.applyEvent(user(0, 'old conversation'))
    app.getEditor().setText('/clear')
    terminal.send('\r')
    await flush()
    expect(openSession).toHaveBeenCalledWith(null)
    expect(app.getTranscriptState().blocks.at(-1)).toMatchObject({ kind: 'notice' })

    const localTerminal = new FakeTerminal()
    const local = new TuiApp({
      terminal: localTerminal,
      inline: true,
      theme: 'dark',
      onSubmit: () => {},
      onAbort: () => {},
      onExit: () => {},
    })
    local.start()
    local.applyEvent(user(0, 'old conversation'))
    local.getEditor().setText('/clear')
    localTerminal.send('\r')
    await flush()
    expect(local.getTranscriptState().blocks).toHaveLength(1)
    expect(local.getTranscriptState().blocks[0]).toMatchObject({ kind: 'notice', text: 'cleared the transcript' })
    local.stop()
    app.stop()
  })
})

/**
 * Wait for the next macrotask so an awaited picker can show its overlay.
 * @returns a promise settled after queued promise callbacks run.
 */
function flush(): Promise<void> {
  return new Promise((resolve) => { setImmediate(resolve) })
}
