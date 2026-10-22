import { describe, expect, it, vi } from 'vitest'
import { describeError, TuiApp, type TuiAppOptions, type TuiHost } from '../src/app/root.ts'
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

/** An approval request addressed to the app's Agent. */
const APPROVAL = {
  agent: { id: 'agent-1' },
  toolName: 'bash',
  reason: 'The tool wants to write build output.',
} as never

/** One selectable model route. */
const MODEL: ModelOption = {
  provider: 'deepseek',
  model: 'deepseek-v4',
  label: 'DeepSeek V4',
  current: true,
}

/** One stored Session row. */
const SESSION: SessionOption = { id: 'session-42', createdAt: Date.now() - 60_000, current: false }

/** One app plus the observations its callbacks recorded. */
interface Harness {
  readonly app: TuiApp
  readonly terminal: FakeTerminal
  readonly submitted: string[]
  readonly aborted: ReturnType<typeof vi.fn>
  readonly exited: ReturnType<typeof vi.fn>
}

/**
 * Build the screen over a fake terminal.
 * @param overrides - options replacing the recording defaults.
 * @param host - optional DSH-backed operations.
 * @returns the app and its recorded callbacks.
 */
function harness(overrides: Partial<TuiAppOptions> = {}, host?: TuiHost): Harness {
  const terminal = new FakeTerminal()
  const submitted: string[] = []
  const aborted = vi.fn()
  const exited = vi.fn()
  const app = new TuiApp({
    terminal,
    inline: true,
    theme: 'dark',
    onSubmit: (text) => { submitted.push(text) },
    onAbort: aborted,
    onExit: exited,
    ...host === undefined ? {} : { host },
    ...overrides,
  })
  return { app, terminal, submitted, aborted, exited }
}

/**
 * Build a complete fake host.
 * @param overrides - operations replacing the default empty answers.
 * @returns the fake host.
 */
function fakeHost(overrides: Partial<TuiHost> = {}): TuiHost {
  return {
    listModels: async () => [],
    selectModel: async () => {},
    listSessions: async () => [],
    openSession: async () => {},
    ...overrides,
  }
}

/**
 * Wait for queued promise callbacks so an awaited picker can show its overlay.
 * @returns a promise settled after queued promise callbacks run.
 */
function flush(): Promise<void> {
  return new Promise((resolve) => { setImmediate(resolve) })
}

/**
 * Remove terminal styling so assertions read the visible text.
 * @param text - rendered frame.
 * @returns the same frame without SGR sequences.
 */
function plain(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/gu, '')
}

describe('screen lifecycle', () => {
  it('starts and stops idempotently and reports its state', () => {
    const { app, terminal } = harness()

    expect(app.isStarted()).toBe(false)
    app.start()
    app.start()
    expect(app.isStarted()).toBe(true)
    expect(terminal.started).toBe(true)

    app.stop()
    app.stop()
    expect(app.isStarted()).toBe(false)
    expect(terminal.started).toBe(false)
  })

  it('ignores projection updates that do not change the transcript', () => {
    const { app } = harness()
    app.applyEvent(user(5, 'once'))
    app.applyDelta('')

    app.applyEvent(user(4, 'older'))
    app.applyDelta('')
    app.applyReasoning('')

    expect(app.getTranscriptState().blocks).toHaveLength(1)
    expect(app.getTranscriptState().lastSeq).toBe(5)
  })

  it('streams reasoning and assistant deltas into the live row', () => {
    const { app, terminal } = harness()
    app.start()
    app.applyReasoning('weighing the options')
    app.applyDelta('partial answer')
    app.renderNow()

    const frame = plain(terminal.visibleLines().join('\n'))
    expect(frame).toContain('◇ thinking…')
    expect(frame).toContain('partial answer')
    app.stop()
  })

  it('clears the abort hint once the Agent is idle again', () => {
    const { app, terminal, aborted } = harness()
    app.start()
    app.setStatus('running')
    terminal.send('\x1b')

    expect(aborted).toHaveBeenCalledTimes(1)
    expect(app.getStatusFields().hint).toBe('aborting…')

    app.setStatus('idle')
    expect(app.getStatusFields().hint).toBe('')
    expect(app.getStatusFields().status).toBe('idle')
    app.stop()
  })

  it('reports failures as error rows and returns to idle', () => {
    const { app } = harness()
    app.setStatus('running')
    app.addError(new Error('provider failed'))
    app.addError('transport failed')

    expect(app.getTranscriptState().blocks).toEqual([
      expect.objectContaining({ kind: 'error', text: 'provider failed' }),
      expect.objectContaining({ kind: 'error', text: 'transport failed' }),
    ])
    expect(app.getTranscriptState().status).toBe('idle')
  })

  it('submits nothing for blank editor text', () => {
    const { app, submitted } = harness()

    app.getEditor().onSubmit?.('   ')

    expect(submitted).toEqual([])
    expect(app.getTranscriptState().blocks).toHaveLength(0)
  })

  it('contains a throwing submit callback as an error row', () => {
    const { app } = harness({
      onSubmit: () => { throw new Error('dispatch failed') },
    })

    app.getEditor().onSubmit?.('run the tests')

    expect(app.getTranscriptState().blocks.at(-1)).toMatchObject({ kind: 'error', text: 'dispatch failed' })
  })
})

describe('approval modal', () => {
  it('falls back to the localized reason and denies on Escape', async () => {
    const { app, terminal } = harness()
    app.start()
    const decision = app.askApproval({
      agent: { id: 'agent-1' },
      toolName: 'bash',
      displayReason: { en: 'Denied by policy.' },
    } as never)
    app.renderNow()

    expect(plain(terminal.visibleLines().join('\n'))).toContain('Denied by policy.')

    terminal.send('\x1b')
    await expect(decision).resolves.toBe('rejected')
    app.stop()
  })

  it('survives a request that names neither reason', async () => {
    const { app, terminal } = harness()
    app.start()
    const decision = app.askApproval({ agent: { id: 'agent-1' }, toolName: 'bash' } as never)
    app.renderNow()
    terminal.send('\r')

    await expect(decision).resolves.toBe('allowed-once')
    app.stop()
  })

  it('contains an overlay that cannot be shown', async () => {
    const { app } = harness()
    app.start()
    vi.spyOn(app.tui, 'showOverlay').mockImplementation(() => { throw new Error('no overlay host') })

    await expect(app.askApproval(APPROVAL)).rejects.toThrow('no overlay host')
    app.stop()
  })

  it('wraps a non-Error overlay failure', async () => {
    const { app } = harness()
    app.start()
    vi.spyOn(app.tui, 'showOverlay').mockImplementation(() => { throw 'overlay down' })

    await expect(app.askApproval(APPROVAL)).rejects.toThrow('overlay down')
    app.stop()
  })
})

describe('question modal', () => {
  it('defers a question that offers no options', async () => {
    const { app } = harness()
    app.start()

    await expect(app.askQuestions({
      questions: [{ id: 'q1', question: 'Free text?', options: [] }],
    })).resolves.toBeNull()
    app.stop()
  })

  it('shows option descriptions and the question detail', async () => {
    const { app, terminal } = harness()
    app.start()
    const answered = app.askQuestions({
      questions: [{
        id: 'q1',
        header: 'Proceed',
        question: 'Continue with the migration?',
        detail: 'This rewrites the stored Sessions.',
        options: [
          { label: 'Yes', description: 'apply the migration' },
          { label: 'No' },
        ],
      }],
    })
    app.renderNow()

    const frame = plain(terminal.visibleLines().join('\n'))
    expect(frame).toContain('Continue with the migration?')
    expect(frame).toContain('This rewrites the stored Sessions.')
    expect(frame).toContain('apply the migration')

    terminal.send('\r')
    await expect(answered).resolves.toEqual({ answers: [{ id: 'q1', selected: ['Yes'] }] })
    app.stop()
  })

  it('answers every question in a batch', async () => {
    const { app, terminal } = harness()
    app.start()
    const answered = app.askQuestions({
      questions: [
        { id: 'q1', question: 'First?', options: [{ label: 'One' }] },
        { id: 'q2', question: 'Second?', options: [{ label: 'Two' }] },
      ],
    })

    for (let step = 0; step < 2; step += 1) {
      await flush()
      app.renderNow()
      terminal.send('\r')
    }

    await expect(answered).resolves.toEqual({
      answers: [{ id: 'q1', selected: ['One'] }, { id: 'q2', selected: ['Two'] }],
    })
    app.stop()
  })

  it('delegates when a question is dismissed', async () => {
    const { app, terminal } = harness()
    app.start()
    const answered = app.askQuestions({
      questions: [{ id: 'q1', question: 'Continue?', options: [{ label: 'Yes' }] }],
    })
    app.renderNow()
    terminal.send('\x1b')

    await expect(answered).resolves.toBeNull()
    app.stop()
  })
})

describe('model picker', () => {
  it('reports that selection is unavailable without a host', async () => {
    const { app } = harness()

    await app.openModelPicker()

    expect(app.getTranscriptState().blocks.at(-1)).toMatchObject({
      kind: 'notice',
      text: 'model selection is unavailable in this build',
    })
  })

  it('reports an enumeration failure as an error row', async () => {
    const { app } = harness({}, fakeHost({
      listModels: async () => { throw new Error('catalog unavailable') },
    }))

    await app.openModelPicker()

    expect(app.getTranscriptState().blocks.at(-1)).toMatchObject({ kind: 'error', text: 'catalog unavailable' })
  })

  it('reports when no route is registered', async () => {
    const { app } = harness({}, fakeHost())

    await app.openModelPicker()

    expect(app.getTranscriptState().blocks.at(-1)).toMatchObject({ kind: 'notice', text: 'no registered model routes' })
  })

  it('applies the chosen route and closes on Escape without applying one', async () => {
    const selectModel = vi.fn(async () => {})
    const { app, terminal } = harness({}, fakeHost({
      listModels: async () => [MODEL],
      selectModel,
    }))
    app.start()

    const picked = app.openModelPicker()
    await flush()
    app.renderNow()
    expect(plain(terminal.visibleLines().join('\n'))).toContain('DeepSeek V4 (current)')
    terminal.send('\r')
    await picked
    expect(selectModel).toHaveBeenCalledWith({ provider: 'deepseek', model: 'deepseek-v4' })
    app.renderNow()
    expect(plain(terminal.visibleLines().join('\n'))).toContain('model → deepseek · deepseek-v4')

    const dismissed = app.openModelPicker()
    await flush()
    terminal.send('\x1b')
    await dismissed
    expect(selectModel).toHaveBeenCalledTimes(1)
    app.stop()
  })

  it('reports a route it cannot decode and a failed selection', async () => {
    const { app, terminal } = harness({}, fakeHost({
      listModels: async () => [{ provider: 'deepseek', model: '', label: 'Broken', current: false }],
    }))
    app.start()
    const invalid = app.openModelPicker()
    await flush()
    terminal.send('\r')
    await invalid
    expect(app.getTranscriptState().blocks.at(-1)).toMatchObject({
      kind: 'error',
      text: 'the model picker produced an unknown route',
    })

    const failing = harness({}, fakeHost({
      listModels: async () => [MODEL],
      selectModel: async () => { throw new Error('route rejected') },
    }))
    failing.app.start()
    const rejected = failing.app.openModelPicker()
    await flush()
    failing.terminal.send('\r')
    await rejected
    expect(failing.app.getTranscriptState().blocks.at(-1)).toMatchObject({
      kind: 'error',
      text: 'route rejected',
    })

    app.stop()
    failing.app.stop()
  })

  it('contains an overlay host that refuses to open the dialog', async () => {
    const { app } = harness({}, fakeHost({ listModels: async () => [MODEL] }))
    app.start()
    vi.spyOn(app.tui, 'showOverlay').mockImplementation(() => { throw new Error('no overlay host') })

    await app.openModelPicker()

    expect(app.getTranscriptState().blocks.at(-1)).toMatchObject({ kind: 'error', text: 'no overlay host' })
    app.stop()
  })

  it('ignores a second picker request while one is open', async () => {
    const listModels = vi.fn(async () => [MODEL])
    const { app, terminal } = harness({}, fakeHost({ listModels }))
    app.start()

    const first = app.openModelPicker()
    const second = app.openModelPicker()
    await flush()
    app.renderNow()

    await second
    expect(listModels).toHaveBeenCalledTimes(1)
    terminal.send('\x1b')
    await first
    app.stop()
  })
})

describe('Session picker', () => {
  it('reports that switching is unavailable without a host', async () => {
    const { app } = harness()

    await app.openSessionPicker()

    expect(app.getTranscriptState().blocks.at(-1)).toMatchObject({
      kind: 'notice',
      text: 'Session switching is unavailable in this build',
    })
  })

  it('reports an enumeration failure as an error row', async () => {
    const { app } = harness({}, fakeHost({
      listSessions: async () => { throw new Error('session store unavailable') },
    }))

    await app.openSessionPicker()

    expect(app.getTranscriptState().blocks.at(-1)).toMatchObject({
      kind: 'error',
      text: 'session store unavailable',
    })
  })

  it('reports when the profile stores no Sessions', async () => {
    const { app } = harness({}, fakeHost())

    await app.openSessionPicker()

    expect(app.getTranscriptState().blocks.at(-1)).toMatchObject({ kind: 'notice', text: 'no stored Sessions' })
  })

  it('pluralizes the stored Session count and opens the chosen one', async () => {
    const openSession = vi.fn(async () => {})
    const { app, terminal } = harness({}, fakeHost({
      listSessions: async () => [SESSION, { ...SESSION, id: 'session-43' }],
      openSession,
    }))
    app.start()

    const picked = app.openSessionPicker()
    await flush()
    app.renderNow()
    const frame = plain(terminal.visibleLines().join('\n'))
    expect(frame).toContain('2 stored Sessions')
    terminal.send('\r')
    await picked

    expect(openSession).toHaveBeenCalledWith('session-42')
    expect(app.getTranscriptState().blocks.at(-1)).toMatchObject({ kind: 'notice', text: 'resumed Session session-' })
    app.stop()
  })

  it('closes on Escape and reports a failed switch', async () => {
    const openSession = vi.fn(async () => {})
    const { app, terminal } = harness({}, fakeHost({
      listSessions: async () => [SESSION],
      openSession,
    }))
    app.start()
    const dismissed = app.openSessionPicker()
    await flush()
    terminal.send('\x1b')
    await dismissed
    expect(openSession).not.toHaveBeenCalled()

    const failing = harness({}, fakeHost({
      listSessions: async () => [SESSION],
      openSession: async () => { throw new Error('the Session is locked') },
    }))
    failing.app.start()
    const rejected = failing.app.openSessionPicker()
    await flush()
    failing.terminal.send('\r')
    await rejected
    expect(failing.app.getTranscriptState().blocks.at(-1)).toMatchObject({
      kind: 'error',
      text: 'the Session is locked',
    })

    app.stop()
    failing.app.stop()
  })

  it('contains an overlay host that refuses to open the dialog', async () => {
    const { app } = harness({}, fakeHost({ listSessions: async () => [SESSION] }))
    app.start()
    vi.spyOn(app.tui, 'showOverlay').mockImplementation(() => { throw new Error('no overlay host') })

    await app.openSessionPicker()

    expect(app.getTranscriptState().blocks.at(-1)).toMatchObject({ kind: 'error', text: 'no overlay host' })
    app.stop()
  })
})

describe('slash commands and global keys', () => {
  it('reports an unknown command', () => {
    const { app, terminal } = harness()
    app.start()
    app.getEditor().setText('/bogus')
    terminal.send('\r')

    expect(app.getTranscriptState().blocks.at(-1)).toMatchObject({
      kind: 'notice',
      text: 'unknown command /bogus · type /help for the command list',
    })
    app.stop()
  })

  it('dispatches /model and /resume to their pickers', async () => {
    const listModels = vi.fn(async () => [])
    const listSessions = vi.fn(async () => [])
    const { app, terminal } = harness({}, fakeHost({ listModels, listSessions }))
    app.start()

    app.getEditor().setText('/model')
    terminal.send('\r')
    await flush()
    expect(listModels).toHaveBeenCalledTimes(1)

    app.getEditor().setText('/resume')
    terminal.send('\r')
    await flush()
    expect(listSessions).toHaveBeenCalledTimes(1)
    app.stop()
  })

  it('starts a new Session from /clear and reports a failed switch', async () => {
    const openSession = vi.fn(async () => {})
    const { app, terminal } = harness({}, fakeHost({ openSession }))
    app.start()
    app.applyEvent(user(0, 'old conversation'))
    app.getEditor().setText('/clear')
    terminal.send('\r')
    await flush()

    expect(openSession).toHaveBeenCalledWith(null)
    expect(app.getTranscriptState().blocks.at(-1)).toMatchObject({ kind: 'notice', text: 'started a new Session' })

    const failing = harness({}, fakeHost({
      openSession: async () => { throw new Error('the store is read-only') },
    }))
    failing.app.start()
    failing.app.getEditor().setText('/clear')
    failing.terminal.send('\r')
    await flush()
    expect(failing.app.getTranscriptState().blocks.at(-1)).toMatchObject({
      kind: 'error',
      text: 'the store is read-only',
    })

    app.stop()
    failing.app.stop()
  })

  it('opens the Session picker from Ctrl+R', async () => {
    const listSessions = vi.fn(async () => [])
    const { app, terminal } = harness({}, fakeHost({ listSessions }))
    app.start()

    terminal.send('\x12')
    await flush()

    expect(listSessions).toHaveBeenCalledTimes(1)
    app.stop()
  })

  it('leaves Ctrl+O alone when nothing is expandable', () => {
    const { app, terminal } = harness()
    app.start()
    app.applyEvent(user(0, 'hello'))

    terminal.send('\x0f')

    expect(app.getTranscriptState().blocks).toHaveLength(1)
    expect(app.getTranscriptState().blocks[0]?.kind).toBe('user')
    app.stop()
  })

  it('cancels a pending Ctrl+C exit with Escape', () => {
    const { app, terminal, exited } = harness()
    app.start()

    terminal.send('\x03')
    expect(app.getStatusFields().hint).toBe('Ctrl+C again to quit')
    terminal.send('\x1b')
    expect(app.getStatusFields().hint).toBe('')
    expect(exited).not.toHaveBeenCalled()

    terminal.send('\x03')
    terminal.send('\x03')
    expect(exited).toHaveBeenCalledTimes(1)
    app.stop()
  })

  it('ignores Escape while the Agent is idle', () => {
    const { app, terminal, aborted } = harness()
    app.start()

    terminal.send('\x1b')

    expect(aborted).not.toHaveBeenCalled()
    expect(app.getStatusFields().status).toBe('idle')
    app.stop()
  })
})

describe('failure description', () => {
  it('renders Error instances and strings directly', () => {
    expect(describeError(new Error('boom'))).toBe('boom')
    expect(describeError('plain text')).toBe('plain text')
  })

  it('serializes a structured failure', () => {
    expect(describeError({ code: 'RATE_LIMIT', message: 'slow down' }))
      .toBe('{"code":"RATE_LIMIT","message":"slow down"}')
  })

  it('falls back to the string form for a cyclic failure', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic['self'] = cyclic

    expect(describeError(cyclic)).toBe('[object Object]')
  })

  it('rethrows a serialization failure that is not a TypeError', () => {
    expect(() => describeError({
      toJSON: () => { throw new Error('cannot serialize') },
    })).toThrow('cannot serialize')
  })
})
