import { describe, expect, it } from 'vitest'
import { TranscriptView } from '../src/app/transcript.ts'
import { themeFor } from '../src/app/theme.ts'
import {
  EMPTY_TRANSCRIPT,
  type DisplayBlock,
  type ToolBlock,
  type TranscriptState,
} from '../src/projection/blocks.ts'

/** Dark theme shared by these tests. */
const THEME = themeFor('dark')

/**
 * Wrap blocks in the transcript state.
 * @param blocks - rows to display.
 * @param overrides - state fields replacing the empty defaults.
 * @returns the projection state.
 */
function state(blocks: readonly DisplayBlock[] = [], overrides: Partial<TranscriptState> = {}): TranscriptState {
  return { ...EMPTY_TRANSCRIPT, blocks, ...overrides }
}

/**
 * Build a tool card.
 * @param overrides - card fields replacing the defaults.
 * @returns the tool block.
 */
function tool(overrides: Partial<ToolBlock> = {}): ToolBlock {
  return {
    kind: 'tool',
    id: 'tool-call-1',
    callId: 'call-1',
    name: 'bash',
    summary: 'ls -la',
    status: 'ok',
    facts: [],
    startedAt: 0,
    expanded: false,
    ...overrides,
  }
}

/**
 * Render one state without terminal styling so assertions read the visible text.
 * @param view - transcript view.
 * @param width - terminal width.
 * @returns the rendered lines.
 */
function render(view: TranscriptView, width = 80): string[] {
  return view.render(width).map(line => line.replace(/\x1b\[[0-9;]*m/gu, ''))
}

describe('transcript view', () => {
  it('exposes its projection and clears cached render state', () => {
    const view = new TranscriptView(THEME, state())
    const next = state([{ kind: 'user', id: 'user-0', text: 'hi' }])

    expect(view.getState().blocks).toHaveLength(0)
    view.setState(next)
    view.invalidate()

    expect(view.getState()).toBe(next)
  })

  it('invites the first prompt when nothing was recorded', () => {
    const lines = render(new TranscriptView(THEME, state()), 100)

    expect(lines.join('\n')).toContain('No messages yet')
  })

  it('shows the Session title above the conversation', () => {
    const titled = render(new TranscriptView(THEME, state([
      { kind: 'user', id: 'user-0', text: 'hello' },
    ], { title: 'Migration' })))

    expect(titled[0]).toContain('Migration')
    expect(titled[1]).toBe('')
    expect(titled.slice(2).join('\n')).toContain('hello')
  })

  it('skips a title that is only whitespace', () => {
    const untitled = render(new TranscriptView(THEME, state([
      { kind: 'user', id: 'user-0', text: 'hello' },
    ], { title: '   ' })))

    expect(untitled[0]).not.toBe('')
    expect(untitled.join('\n')).not.toContain('   ')
  })

  it('renders an assistant row that carries no text yet', () => {
    const frame = render(new TranscriptView(THEME, state([
      { kind: 'assistant', id: 'assistant-0', text: '', streaming: true },
    ]))).join('\n')

    expect(frame).toContain('◆ assistant …')
  })

  it('renders user, assistant, error, and notice rows', () => {
    const view = new TranscriptView(THEME, state([
      { kind: 'user', id: 'user-0', text: 'please list the files' },
      { kind: 'assistant', id: 'assistant-1', text: 'Here they are.', streaming: false },
      { kind: 'error', id: 'error-2', text: 'the provider failed' },
      { kind: 'notice', id: 'notice-3', text: 'turn aborted\nsecond line' },
    ]))

    const frame = render(view).join('\n')

    expect(frame).toContain('❯ you')
    expect(frame).toContain('please list the files')
    expect(frame).toContain('◆ assistant')
    expect(frame).toContain('Here they are.')
    expect(frame).toContain('✗ error')
    expect(frame).toContain('the provider failed')
    expect(frame).toContain('· turn aborted')
    expect(frame).toContain('  second line')
  })
})

describe('tool cards', () => {
  it('shows a running card with no detail lines and no duration', () => {
    const frame = render(new TranscriptView(THEME, state([
      tool({ status: 'running', summary: 'bash' }),
    ]))).join('\n')

    expect(frame).toContain('… bash')
    expect(frame).not.toContain('▸')
    expect(frame).not.toContain('ms')
  })

  it('marks a failed card in the error palette', () => {
    const frame = render(new TranscriptView(THEME, state([
      tool({ status: 'error', summary: 'false', result: 'exit 1' }),
    ]))).join('\n')

    expect(frame).toContain('✗ bash')
    expect(frame).toContain('└ exit 1')
  })

  it('shows the invocation detail above a collapsed result', () => {
    const frame = render(new TranscriptView(THEME, state([
      tool({ detail: '$ ls -la', durationMs: 1_250, result: 'a.txt' }),
    ]))).join('\n')

    expect(frame).toContain('▸ ✓ bash · ls -la · 1.3s')
    expect(frame).toContain('$ ls -la')
    expect(frame).toContain('└ a.txt')
  })

  it('renders only the detail line for a card without a result', () => {
    const lines = render(new TranscriptView(THEME, state([tool({ detail: '$ sleep 1' })])))

    expect(lines.join('\n')).toContain('$ sleep 1')
    expect(lines.join('\n')).not.toContain('└')
  })

  it('expands the output and metadata facts', () => {
    const frame = render(new TranscriptView(THEME, state([
      tool({
        expanded: true,
        output: 'first line\nsecond line',
        facts: ['cwd /repo', 'exit 0'],
        durationMs: 250,
      }),
    ]))).join('\n')

    expect(frame).toContain('▾ ✓ bash · ls -la · cwd /repo · exit 0 · 250ms')
    expect(frame).toContain('first line')
    expect(frame).toContain('second line')
    expect(frame).toContain('cwd /repo · exit 0')
  })

  it('expands a card that carries only facts', () => {
    const frame = render(new TranscriptView(THEME, state([
      tool({ expanded: true, output: '', facts: ['cwd /repo'] }),
    ]))).join('\n')

    expect(frame).toContain('▾ ✓ bash')
    expect(frame).toContain('cwd /repo')
  })

  it('expands a card that carries only output', () => {
    const frame = render(new TranscriptView(THEME, state([
      tool({ expanded: true, output: 'only output', facts: [] }),
    ]))).join('\n')

    expect(frame).toContain('only output')
  })

  it('bounds every card line to the terminal width', () => {
    const lines = render(new TranscriptView(THEME, state([
      tool({ detail: 'x'.repeat(200), result: 'y'.repeat(200), durationMs: 12 }),
    ])), 20)

    for (const line of lines) expect(line.replace(/\x1b\[[0-9;]*m/gu, '').length).toBeLessThanOrEqual(20)
  })
})

describe('reasoning rows', () => {
  it('collapses reasoning to its first line and length', () => {
    const frame = render(new TranscriptView(THEME, state([
      { kind: 'reasoning', id: 'reasoning-0', text: 'First thought\nSecond thought', expanded: false },
    ]))).join('\n')

    expect(frame).toContain('▸ ◇ reasoning · 28 chars')
    expect(frame).toContain('└ First thought')
    expect(frame).not.toContain('Second thought')
  })

  it('expands the full reasoning text', () => {
    const frame = render(new TranscriptView(THEME, state([
      { kind: 'reasoning', id: 'reasoning-0', text: 'First thought\nSecond thought', expanded: true },
    ]))).join('\n')

    expect(frame).toContain('▾ ◇ reasoning')
    expect(frame).toContain('Second thought')
  })

  it('omits the preview for reasoning that collapses to nothing', () => {
    const lines = render(new TranscriptView(THEME, state([
      { kind: 'reasoning', id: 'reasoning-0', text: ' ', expanded: false },
    ])))

    expect(lines.join('\n')).not.toContain('└')
  })
})

describe('live stream rows', () => {
  it('shows streamed reasoning without a separator when no rows exist', () => {
    const lines = render(new TranscriptView(THEME, state([], {
      liveReasoning: 'considering the options',
    })))

    expect(lines[0]).toContain('◇ thinking… · 23 chars')
  })

  it('separates live reasoning from the recorded conversation', () => {
    const lines = render(new TranscriptView(THEME, state([
      { kind: 'user', id: 'user-0', text: 'hi' },
    ], { liveReasoning: 'considering' })))

    expect(lines.at(-2)).toBe('')
    expect(lines.at(-1)).toContain('◇ thinking…')
  })

  it('shows streamed assistant text as a streaming row', () => {
    const frame = render(new TranscriptView(THEME, state([], {
      liveAssistant: 'partial answer',
    }))).join('\n')

    expect(frame).toContain('◆ assistant …')
    expect(frame).toContain('partial answer')
  })

  it('clamps the render width to at least one column', () => {
    const lines = render(new TranscriptView(THEME, state([
      { kind: 'user', id: 'user-0', text: 'wide text' },
    ])), 0)

    expect(lines.length).toBeGreaterThan(0)
  })
})
