import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { TuiApp } from '../src/app/root.ts'
import { apply } from '../src/index.ts'
import type { TuiStartupValues } from '../src/startup.ts'
import type { BootTerminal as BootTerminalType } from './support/boot-terminal.ts'

/** Terminals the row constructed, in boot order. */
const terminals = vi.hoisted(() => ({ created: [] as BootTerminalType[] }))

/** Screens the row constructed and started, in boot order. */
const screens = vi.hoisted(() => ({ created: [] as TuiApp[], started: [] as TuiApp[] }))

vi.mock('../src/term/pi-tui.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/term/pi-tui.ts')>()
  const { BootTerminal: Fake } = await import('./support/boot-terminal.ts')
  class TestProcessTerminal extends Fake {
    constructor() {
      super()
      terminals.created.push(this)
    }
  }
  return { ...actual, ProcessTerminal: TestProcessTerminal }
})

vi.mock('../src/app/root.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/app/root.ts')>()
  class CapturingTuiApp extends actual.TuiApp {
    constructor(options: ConstructorParameters<typeof actual.TuiApp>[0]) {
      super(options)
      screens.created.push(this)
    }

    override start(): void {
      super.start()
      screens.started.push(this)
    }
  }
  return { ...actual, TuiApp: CapturingTuiApp }
})

/** The default invocation values. */
const STARTUP: TuiStartupValues = {
  resume: null,
  model: null,
  provider: null,
  theme: null,
  inline: true,
}

/** The route the fake default-model service resolves. */
const DEFAULT_SELECTION = { provider: 'deepseek', model: 'deepseek-flash' }

/** One Agent-open call the fake service recorded. */
interface OpenCall {
  readonly resumeSessionId?: string
  readonly agentOptions?: { readonly provider?: string; readonly model?: string; readonly cwd?: string }
}

/** One fake Agent the row can own. */
interface FakeAgent {
  readonly id: string
  readonly session: { readonly id: SessionId }
  readonly options: { readonly provider?: string; readonly model?: string }
  readonly ctx: Context
  status: 'idle' | 'running'
  readonly followup: ReturnType<typeof vi.fn>
  readonly steer: ReturnType<typeof vi.fn>
  readonly cancel: ReturnType<typeof vi.fn>
}

/** One fake Agent handle. */
interface FakeHandle {
  readonly agent: FakeAgent
  readonly dispose: ReturnType<typeof vi.fn>
}

/**
 * Build one fake Agent.
 * @param id - Agent id.
 * @param sessionId - durable Session id.
 * @returns the fake Agent.
 */
function makeAgent(id: string, sessionId: string): FakeAgent {
  return {
    id,
    session: { id: SessionId(sessionId) },
    options: { provider: 'deepseek', model: 'deepseek-flash' },
    ctx: new Context(),
    status: 'idle',
    followup: vi.fn(),
    steer: vi.fn(),
    cancel: vi.fn(),
  }
}

/**
 * Build one fake handle whose disposal the test controls.
 * @param agent - the Agent the handle owns.
 * @returns the fake handle.
 */
function makeHandle(agent: FakeAgent): FakeHandle {
  return { agent, dispose: vi.fn(async () => {}) }
}

/** Options the boot harness varies. */
interface BootOptions {
  readonly startup?: TuiStartupValues | null
  readonly selection?: { readonly provider: string; readonly model: string } | undefined
  readonly llm?: 'catalog' | 'none' | 'failing' | undefined
  readonly sessionQuery?: {
    readonly events?: readonly unknown[]
    readonly list?: readonly unknown[]
  } | null
  readonly readSession?: (() => Promise<{ events: readonly unknown[] }>) | undefined
  readonly create?: (() => Promise<FakeHandle>) | undefined
  readonly resume?: ((sessionId: string) => Promise<FakeHandle>) | undefined
  readonly onReady?: 'once' | 'twice' | 'defer'
  readonly isTTY?: boolean
}

/** One booted row and the fakes it observed. */
interface Boot {
  readonly ctx: Context
  readonly exits: number[]
  readonly written: string[]
  readonly created: number[]
  readonly resumed: string[]
  readonly openCalls: OpenCall[]
  readonly ready: Array<() => void>
  readonly handles: FakeHandle[]
  readonly terminal: () => BootTerminalType
  readonly signalHandler: () => (() => void) | undefined
}

/**
 * Boot the row over fake services.
 * @param options - fakes and invocation values.
 * @returns the context and recorded effects.
 */
function boot(options: BootOptions = {}): Boot {
  const ctx = new Context()
  const exits: number[] = []
  const written: string[] = []
  const created: number[] = []
  const resumed: string[] = []
  const openCalls: OpenCall[] = []
  const ready: Array<() => void> = []
  const handles: FakeHandle[] = []
  const listenersBefore = new Set(process.listeners('SIGINT'))
  const startup = options.startup === undefined ? STARTUP : options.startup
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    written.push(String(chunk))
    return true
  })

  ctx.provide('agents', {
    create: async (call: OpenCall) => {
      created.push(created.length)
      openCalls.push(call)
      const handle = options.create === undefined
        ? makeHandle(makeAgent('agent-1', 'session-1'))
        : await options.create()
      handles.push(handle)
      return handle
    },
    resume: async (call: OpenCall) => {
      resumed.push(String(call.resumeSessionId))
      openCalls.push(call)
      const handle = options.resume === undefined
        ? makeHandle(makeAgent('agent-2', String(call.resumeSessionId)))
        : await options.resume(String(call.resumeSessionId))
      handles.push(handle)
      return handle
    },
  } as never)
  if (options.selection !== undefined) {
    ctx.provide('agentDefaultModel', { currentSelection: () => options.selection } as never)
  }
  if (options.llm === 'catalog') {
    ctx.provide('llm', {
      listProviders: () => [{ id: 'deepseek' }],
      listModels: async () => [{ id: 'deepseek-v4', name: 'DeepSeek V4' }],
      resolveCallConfig: async (route: { provider: string; model: string }) => route,
    } as never)
  }
  if (options.sessionQuery !== null && options.sessionQuery !== undefined) {
    const query = options.sessionQuery
    const readSession = options.readSession ?? (async () => ({ events: query.events ?? [] }))
    ctx.provide('sessionQuery', {
      readSession,
      listSessions: async () => query.list ?? [],
    } as never)
  }
  if (options.readSession !== undefined && (options.sessionQuery === null || options.sessionQuery === undefined)) {
    ctx.provide('sessionQuery', {
      readSession: options.readSession,
      listSessions: async () => [],
    } as never)
  }
  ctx.provide('appReady', {
    onReady: (listener: () => void) => {
      if (options.onReady === 'defer') {
        ready.push(listener)
        return () => {}
      }
      if (options.onReady === 'twice') {
        listener()
        listener()
        return () => {}
      }
      listener()
      return () => {}
    },
  })
  ctx.provide('appExit', (code: number) => { exits.push(code) })
  if (startup !== null) ctx.provide('tuiStartup', startup)

  const previousTty = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
  Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: options.isTTY !== false })
  apply(ctx, { theme: 'dark', inline: false })
  if (options.isTTY === false) {
    Object.defineProperty(process.stdout, 'isTTY', previousTty ?? { configurable: true, value: undefined })
  }

  return {
    ctx,
    exits,
    written,
    created,
    resumed,
    openCalls,
    ready,
    handles,
    terminal: () => terminals.created.at(-1) as BootTerminalType,
    signalHandler: () => process.listeners('SIGINT').find(listener => !listenersBefore.has(listener)) as
      (() => void) | undefined,
  }
}

/**
 * Let queued microtasks and macrotasks settle.
 * @returns a promise settled after the next macrotask turn.
 */
function settle(): Promise<void> {
  return new Promise((resolve) => { setImmediate(resolve) })
}

/**
 * Type text into the running editor.
 * @param terminal - fake terminal that owns stdin.
 * @param text - text to insert.
 */
function type(terminal: BootTerminalType, text: string): void {
  for (const character of text) terminal.send(character)
}

/**
 * Send the run key to the editor.
 * @param terminal - fake terminal that owns stdin.
 */
function enter(terminal: BootTerminalType): void {
  terminal.send('\r')
}

/**
 * The last row the running screen shows.
 * @returns the newest transcript block.
 */
function lastBlock(): unknown {
  return started.at(-1)?.getTranscriptState().blocks.at(-1)
}

/**
 * Emit one durable Session event through the process-global bus.
 * @param ctx - row context.
 * @param sessionId - Session the event belongs to.
 * @param event - event body.
 */
function emitSession(ctx: Context, sessionId: string, event: unknown): void {
  ctx.emit('session/event', { id: SessionId(sessionId) } as never, event as never)
}

/** Screens whose renderer was started, in boot order. */
const started = screens.started

describe('tui-app boot', () => {
  const originalTty = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')

  beforeEach(() => {
    terminals.created.length = 0
    screens.created.length = 0
    started.length = 0
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(process.stdout, 'isTTY', originalTty ?? { configurable: true, value: undefined })
  })

  it('opens the Session from the flags and wires the screen to the Agent and Host', async () => {
    const row = boot({
      startup: { ...STARTUP, provider: 'deepseek', theme: 'dark' },
      selection: DEFAULT_SELECTION,
      llm: 'catalog',
      sessionQuery: {
        list: [{ header: { id: SessionId('session-9'), createdAt: 1 } }],
        events: [
          {
            type: 'user/message',
            seq: 0,
            time: 1,
            data: { content: [{ type: 'text', text: 'remembered' }], source: { kind: 'user' } },
          },
        ],
      },
    })
    await settle()

    const terminal = row.terminal()
    expect(row.created).toHaveLength(1)
    expect(row.openCalls[0]?.agentOptions).toEqual({ provider: 'deepseek', model: 'deepseek-flash' })
    expect(terminal.started).toBe(true)
    const agent = row.handles[0]?.agent as FakeAgent

    type(terminal, 'run the tests')
    enter(terminal)
    expect(agent.followup).toHaveBeenCalledTimes(1)

    terminal.send('\x1b')
    expect(agent.cancel).toHaveBeenCalledWith({ kind: 'user' }, { keepInbox: true })

    terminal.send('\x10')
    await settle()
    terminal.send('\r')
    await settle()
    expect(row.written.join('')).not.toContain('tui:')

    terminal.send('\x12')
    await settle()
    terminal.send('\r')
    await settle()
    expect(row.resumed).toEqual(['session-9'])
    expect(row.handles[0]?.dispose).toHaveBeenCalledTimes(1)

    emitSession(row.ctx, 'session-9', {
      type: 'assistant/message',
      seq: 2,
      time: 3,
      data: { message: { content: [{ type: 'text', text: 'replayed answer' }] } },
    })
    row.ctx.emit('agent/assistant-stream', {
      agent: { id: 'agent-2' },
      frame: { type: 'chunk', chunk: { type: 'text-delta', text: 'streamed' } },
    } as never)
    row.ctx.emit('agent/assistant-stream', {
      agent: { id: 'agent-2' },
      frame: { type: 'chunk', chunk: { type: 'reasoning-delta', text: 'thinking' } },
    } as never)
    row.ctx.emit('agent/status', { agent: { id: 'agent-2' }, status: 'idle' } as never)
    row.ctx.emit('agent/error', { agent: { id: 'agent-2' }, error: new Error('late failure') } as never)
    await settle()

    terminal.send('\x03')
    terminal.send('\x03')
    await settle()

    expect(row.exits).toEqual([0])
    expect(terminal.started).toBe(false)
    await row.ctx.fiber.dispose()
  })

  it('replays a resumed Session event log and skips untracked event types', async () => {
    const row = boot({
      startup: { ...STARTUP, resume: 'session-7' },
      selection: DEFAULT_SELECTION,
      sessionQuery: {
        events: [
          {
            type: 'user/message',
            seq: 0,
            time: 1,
            data: { content: [{ type: 'text', text: 'from the log' }], source: { kind: 'user' } },
          },
          { type: 'session/created', seq: 1, time: 2 },
        ],
      },
    })
    await settle()

    expect(row.resumed).toEqual(['session-7'])
    expect(started.at(-1)?.getTranscriptState().blocks).toEqual([
      expect.objectContaining({ kind: 'user', text: 'from the log' }),
    ])
    await row.ctx.fiber.dispose()
  })

  it('starts the renderer in the main screen when the invocation asks for it', async () => {
    const row = boot({
      startup: { ...STARTUP, inline: false },
      selection: DEFAULT_SELECTION,
    })
    await settle()

    expect(started.at(-1)?.tui.mode).toBe('fullscreen')
    await row.ctx.fiber.dispose()
  })

  it('refuses to boot without the startup service', async () => {
    const row = boot({ startup: null })
    await settle()

    expect(row.exits).toEqual([1])
    expect(row.written.join('')).toContain('the tui-startup row did not provide tuiStartup')
    expect(row.created).toHaveLength(0)
    await row.ctx.fiber.dispose()
  })

  it('boots only once even when readiness is announced twice', async () => {
    const row = boot({ selection: DEFAULT_SELECTION, onReady: 'twice' })
    await settle()

    expect(row.created).toHaveLength(1)
    expect(terminals.created).toHaveLength(1)
    await row.ctx.fiber.dispose()
  })

  it('never boots when the tree was disposed before readiness', async () => {
    const row = boot({ selection: DEFAULT_SELECTION, onReady: 'defer' })
    await row.ctx.fiber.dispose()

    row.ready[0]?.()
    await settle()

    expect(row.created).toHaveLength(0)
    expect(terminals.created).toHaveLength(0)
    expect(row.exits).toEqual([])
  })

  it('reports a Session that cannot be opened and exits 1', async () => {
    const row = boot({
      selection: DEFAULT_SELECTION,
      create: async () => { throw new Error('the provider rejected the request') },
    })
    await settle()

    expect(row.exits).toEqual([1])
    expect(row.written.join('')).toContain('tui: the provider rejected the request')
    await row.ctx.fiber.dispose()
  })

  it('reports a resume that requires sessionQuery', async () => {
    const row = boot({
      startup: { ...STARTUP, resume: 'session-7' },
      selection: DEFAULT_SELECTION,
      sessionQuery: null,
    })
    await settle()

    expect(row.exits).toEqual([1])
    expect(row.written.join('')).toContain('requires the sessionQuery service')
    await row.ctx.fiber.dispose()
  })

  it('answers the human-interaction waterfalls for the owned Agent', async () => {
    const row = boot({ selection: DEFAULT_SELECTION })
    await settle()
    const terminal = row.terminal()
    const fallback = vi.fn(async () => 'unavailable' as const)

    const approval = row.ctx.waterfall(
      'approval/request',
      { agent: { id: 'agent-1' }, toolName: 'bash', reason: 'write output' } as never,
      fallback,
    )
    await settle()
    terminal.send('\r')
    await expect(approval).resolves.toBe('allowed-once')
    expect(fallback).not.toHaveBeenCalled()

    const questions = row.ctx.waterfall(
      'user-questions/request',
      {
        agent: { id: 'agent-1' },
        questions: [{ id: 'q1', question: 'Continue?', options: [{ label: 'Yes' }] }],
      } as never,
      async () => ({ answers: [] }),
    )
    await settle()
    terminal.send('\r')
    await expect(questions).resolves.toEqual({ answers: [{ id: 'q1', selected: ['Yes'] }] })

    await row.ctx.fiber.dispose()
  })

  it('delegates a waterfall while a resumed Session is still replaying', async () => {
    const read = Promise.withResolvers<{ events: readonly unknown[] }>()
    const row = boot({
      startup: { ...STARTUP, resume: 'session-7' },
      selection: DEFAULT_SELECTION,
      readSession: () => read.promise,
    })
    await settle()

    const fallback = vi.fn(async () => 'unavailable' as const)
    const decision = row.ctx.waterfall(
      'approval/request',
      { agent: { id: 'agent-2' }, toolName: 'bash' } as never,
      fallback,
    )
    await expect(decision).resolves.toBe('unavailable')
    expect(fallback).toHaveBeenCalledTimes(1)

    read.resolve({ events: [] })
    await settle()
    expect(started).toHaveLength(1)
    await row.ctx.fiber.dispose()
  })

  it('never starts the renderer when shutdown lands during resume replay', async () => {
    const read = Promise.withResolvers<{ events: readonly unknown[] }>()
    const row = boot({
      startup: { ...STARTUP, resume: 'session-7' },
      selection: DEFAULT_SELECTION,
      readSession: () => read.promise,
    })
    await settle()

    row.signalHandler()?.()
    await settle()
    read.resolve({ events: [] })
    await settle()

    expect(row.exits).toEqual([0])
    expect(started).toHaveLength(0)
    expect(row.handles[0]?.dispose).toHaveBeenCalledTimes(1)
    await row.ctx.fiber.dispose()
  })

  it('contains an open failure that follows shutdown', async () => {
    const read = Promise.withResolvers<{ events: readonly unknown[] }>()
    const row = boot({
      startup: { ...STARTUP, resume: 'session-7' },
      selection: DEFAULT_SELECTION,
      readSession: () => read.promise,
    })
    await settle()

    row.signalHandler()?.()
    await settle()
    read.reject(new Error('the log vanished'))
    await settle()

    expect(row.exits).toEqual([0])
    expect(row.written.join('')).toBe('')
    await row.ctx.fiber.dispose()
  })

  it('disposes a Session that finishes opening after shutdown', async () => {
    const open = Promise.withResolvers<FakeHandle>()
    const row = boot({
      startup: { ...STARTUP, resume: 'session-7' },
      selection: DEFAULT_SELECTION,
      resume: () => open.promise,
    })
    await settle()
    expect(row.resumed).toEqual(['session-7'])

    row.signalHandler()?.()
    await settle()
    const handle = makeHandle(makeAgent('agent-3', 'session-7'))
    open.resolve(handle)
    await settle()

    expect(handle.dispose).toHaveBeenCalledTimes(1)
    expect(row.exits).toEqual([0])
    expect(started).toHaveLength(0)
    await row.ctx.fiber.dispose()
  })

  it('keeps the exit path alive when the renderer fails to restore', async () => {
    const row = boot({ selection: DEFAULT_SELECTION })
    await settle()
    vi.spyOn(TuiApp.prototype, 'stop').mockImplementation(() => { throw new Error('terminal stuck') })

    row.signalHandler()?.()
    await settle()

    expect(row.written.join('')).toContain('failed to restore the terminal: terminal stuck')
    expect(row.exits).toEqual([0])
    await row.ctx.fiber.dispose()
  })

  it('reports a Session that cannot be closed during shutdown', async () => {
    const row = boot({
      selection: DEFAULT_SELECTION,
      create: async () => {
        const handle = makeHandle(makeAgent('agent-1', 'session-1'))
        handle.dispose.mockRejectedValue(new Error('the log is locked'))
        return handle
      },
    })
    await settle()

    row.signalHandler()?.()
    await settle()

    expect(row.written.join('')).toContain('failed to close the Session: the log is locked')
    expect(row.exits).toEqual([0])
    await row.ctx.fiber.dispose()
  })

  it('continues a switch whose previous Session cannot be closed', async () => {
    const row = boot({
      selection: DEFAULT_SELECTION,
      llm: 'catalog',
      sessionQuery: { list: [{ header: { id: SessionId('session-9'), createdAt: 1 } }] },
    })
    await settle()
    const terminal = row.terminal()
    row.handles[0]?.dispose.mockRejectedValue(new Error('the old log is locked'))

    terminal.send('\x12')
    await settle()
    terminal.send('\r')
    await settle()

    expect(row.written.join('')).toContain('failed to close the previous Session: the old log is locked')
    expect(row.resumed).toEqual(['session-9'])
    emitSession(row.ctx, 'session-9', {
      type: 'assistant/message',
      seq: 2,
      time: 3,
      data: { message: { content: [{ type: 'text', text: 'the switch survived' }] } },
    })
    expect(lastBlock()).toMatchObject({ kind: 'assistant', text: 'the switch survived' })
    await row.ctx.fiber.dispose()
  })

  it('keeps the previous Session and its Agent after a failed switch', async () => {
    const row = boot({
      startup: { ...STARTUP, provider: 'deepseek', model: 'deepseek-v4' },
      selection: DEFAULT_SELECTION,
      llm: 'catalog',
      sessionQuery: { list: [{ header: { id: SessionId('session-9'), createdAt: 1 } }] },
      resume: async () => { throw new Error('the Session is locked') },
    })
    await settle()
    const terminal = row.terminal()
    const previous = row.handles[0] as FakeHandle

    terminal.send('\x12')
    await settle()
    terminal.send('\r')
    await settle()

    expect(lastBlock()).toMatchObject({ kind: 'error', text: 'the Session is locked' })
    expect(previous.dispose).not.toHaveBeenCalled()

    type(terminal, 'still here')
    enter(terminal)
    expect(previous.agent.followup).toHaveBeenCalledTimes(1)

    terminal.send('\x1b')
    expect(previous.agent.cancel).toHaveBeenCalledWith({ kind: 'user' }, { keepInbox: true })

    terminal.send('\x10')
    await settle()
    terminal.send('\r')
    await settle()
    expect(lastBlock()).toMatchObject({ kind: 'notice', text: 'model → deepseek · deepseek-v4' })

    emitSession(row.ctx, 'session-1', {
      type: 'assistant/message',
      seq: 2,
      time: 3,
      data: { message: { content: [{ type: 'text', text: 'still rendered' }] } },
    })
    expect(lastBlock()).toMatchObject({ kind: 'assistant', text: 'still rendered' })

    type(terminal, '/clear')
    enter(terminal)
    await settle()
    expect(row.created).toHaveLength(2)
    expect(previous.dispose).toHaveBeenCalledTimes(1)
    await row.ctx.fiber.dispose()
  })

  it('replaces the previous Agent only after the next Session opens', async () => {
    const opened = Promise.withResolvers<FakeHandle>()
    const row = boot({
      selection: DEFAULT_SELECTION,
      sessionQuery: { list: [{ header: { id: SessionId('session-9'), createdAt: 1 } }] },
      resume: () => opened.promise,
    })
    await settle()
    const terminal = row.terminal()
    const previous = row.handles[0] as FakeHandle

    type(terminal, 'before the switch')
    enter(terminal)
    terminal.send('\x12')
    await settle()
    terminal.send('\r')
    await settle()

    expect(previous.dispose).not.toHaveBeenCalled()
    type(terminal, 'during the open')
    enter(terminal)
    expect(previous.agent.followup).toHaveBeenCalledTimes(2)

    const next = makeHandle(makeAgent('agent-2', 'session-9'))
    opened.resolve(next)
    await settle()

    expect(previous.dispose).toHaveBeenCalledTimes(1)
    expect(row.resumed).toEqual(['session-9'])
    expect(lastBlock()).toMatchObject({ kind: 'notice', text: 'resumed Session session-' })

    emitSession(row.ctx, 'session-1', {
      type: 'assistant/message',
      seq: 2,
      time: 3,
      data: { message: { content: [{ type: 'text', text: 'stale' }] } },
    })
    expect(lastBlock()).toMatchObject({ kind: 'notice' })
    emitSession(row.ctx, 'session-9', {
      type: 'assistant/message',
      seq: 2,
      time: 3,
      data: { message: { content: [{ type: 'text', text: 'fresh' }] } },
    })
    expect(lastBlock()).toMatchObject({ kind: 'assistant', text: 'fresh' })

    type(terminal, 'after the switch')
    enter(terminal)
    expect(next.agent.followup).toHaveBeenCalledTimes(1)
    await row.ctx.fiber.dispose()
  })

  it('serves the new Agent while the previous Session is still closing', async () => {
    const closing = Promise.withResolvers<undefined>()
    const row = boot({
      selection: DEFAULT_SELECTION,
      sessionQuery: { list: [{ header: { id: SessionId('session-9'), createdAt: 1 } }] },
    })
    await settle()
    const terminal = row.terminal()
    const previous = row.handles[0] as FakeHandle
    previous.dispose.mockReturnValue(closing.promise)

    terminal.send('\x12')
    await settle()
    terminal.send('\r')
    await settle()
    const next = row.handles[1] as FakeHandle

    type(terminal, 'start a turn')
    enter(terminal)
    expect(next.agent.followup).toHaveBeenCalledTimes(1)
    expect(previous.agent.followup).not.toHaveBeenCalled()

    terminal.send('\x1b')
    expect(next.agent.cancel).toHaveBeenCalledWith({ kind: 'user' }, { keepInbox: true })
    expect(previous.agent.cancel).not.toHaveBeenCalled()

    closing.resolve(undefined)
    await settle()
    expect(row.resumed).toEqual(['session-9'])
    await row.ctx.fiber.dispose()
  })

  it('discards a Session that opens after shutdown interrupted the switch', async () => {
    const opened = Promise.withResolvers<FakeHandle>()
    const readSession = vi.fn(async () => ({ events: [] }))
    const row = boot({
      selection: DEFAULT_SELECTION,
      sessionQuery: { list: [{ header: { id: SessionId('session-9'), createdAt: 1 } }] },
      resume: () => opened.promise,
      readSession,
    })
    await settle()
    const terminal = row.terminal()

    terminal.send('\x12')
    await settle()
    terminal.send('\r')
    await settle()

    row.signalHandler()?.()
    await settle()
    const late = makeHandle(makeAgent('agent-2', 'session-9'))
    opened.resolve(late)
    await settle()

    expect(row.exits).toEqual([0])
    expect(late.dispose).toHaveBeenCalledTimes(1)
    expect(readSession).not.toHaveBeenCalled()
    await row.ctx.fiber.dispose()
  })

  it('skips the replay when shutdown lands while the previous Session closes', async () => {
    const closing = Promise.withResolvers<undefined>()
    const readSession = vi.fn(async () => ({ events: [] }))
    const row = boot({
      selection: DEFAULT_SELECTION,
      sessionQuery: { list: [{ header: { id: SessionId('session-9'), createdAt: 1 } }] },
      readSession,
    })
    await settle()
    const terminal = row.terminal()
    const previous = row.handles[0] as FakeHandle
    previous.dispose.mockReturnValue(closing.promise)

    terminal.send('\x12')
    await settle()
    terminal.send('\r')
    await settle()

    row.signalHandler()?.()
    await settle()
    closing.resolve(undefined)
    await settle()

    expect(row.exits).toEqual([0])
    expect(readSession).not.toHaveBeenCalled()
    expect(row.handles[1]?.dispose).toHaveBeenCalledTimes(1)
    await row.ctx.fiber.dispose()
  })

  it('reports a resume that cannot be opened and exits 1', async () => {
    const row = boot({
      startup: { ...STARTUP, resume: 'session-7' },
      selection: DEFAULT_SELECTION,
      resume: async () => { throw new Error('the Session is locked') },
    })
    await settle()

    expect(row.exits).toEqual([1])
    expect(row.written.join('')).toContain('tui: the Session is locked')
    expect(row.handles).toHaveLength(0)
    expect(started).toHaveLength(0)
    await row.ctx.fiber.dispose()
  })

  it('applies every invocation override to a resumed Agent', async () => {
    const row = boot({
      startup: { ...STARTUP, resume: 'session-7', model: 'deepseek-v4', provider: 'deepseek-account' },
      sessionQuery: { events: [] },
    })
    await settle()

    expect(row.resumed).toEqual(['session-7'])
    expect(row.openCalls[0]?.agentOptions).toEqual({ provider: 'deepseek-account', model: 'deepseek-v4' })
    await row.ctx.fiber.dispose()
  })
})
