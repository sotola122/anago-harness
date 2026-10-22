import { describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { TuiApp } from '../src/app/root.ts'
import { visibleWidth } from '../src/term/pi-tui.ts'
import type { ProjectableTranscriptEvent } from '../src/projection/blocks.ts'
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
    expect(frame).toContain('a.txt b.txt')
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
})
