import { describe, expect, it } from 'vitest'
import {
  describeToolInvocation,
  formatDuration,
  summarizeToolCall,
  summarizeToolResult,
  TOOL_OUTPUT_LIMIT,
} from '../src/projection/tools.ts'

describe('tool invocation summaries', () => {
  it('prefers the model-written description and keeps the command as detail', () => {
    const invocation = describeToolInvocation('bash', JSON.stringify({
      description: 'List files in current directory',
      command: 'ls -la',
    }))
    expect(invocation).toEqual({ summary: 'List files in current directory', detail: '$ ls -la' })
  })

  it('falls back to the command when the shell call has no description', () => {
    expect(describeToolInvocation('bash', JSON.stringify({ command: 'ls -la' }))).toEqual({ summary: 'ls -la' })
  })

  it('shows the path and read offset', () => {
    expect(describeToolInvocation('read', JSON.stringify({ file_path: '/repo/a.ts', offset: 20 })))
      .toEqual({ summary: '/repo/a.ts', detail: 'from line 20' })
  })

  it('shows a search pattern with its directory', () => {
    expect(describeToolInvocation('grep', JSON.stringify({ pattern: 'TODO', path: 'src' })))
      .toEqual({ summary: 'TODO', detail: 'src' })
  })

  it('summarizes known structured arguments for list-shaped tools', () => {
    expect(describeToolInvocation('todo_write', JSON.stringify({ todos: [{}, {}] })).summary).toBe('2 items')
    expect(describeToolInvocation('ask_user_question', JSON.stringify({ questions: [{}] })).summary).toBe('1 question')
  })

  it('keeps unknown tools readable instead of hiding them', () => {
    expect(describeToolInvocation('mystery', JSON.stringify({ query: ['alpha', 'beta'] })).summary).toBe('alpha beta')
    expect(describeToolInvocation('mystery', '{not json').summary).toBe('{not json')
    expect(describeToolInvocation('mystery', '').summary).toBe('mystery')
    expect(summarizeToolCall('mystery', JSON.stringify({ target: 'x' }))).toBe('{"target":"x"}')
  })
})

describe('tool result summaries', () => {
  it('keeps a multi-line result bounded and previews its first line', () => {
    const summary = summarizeToolResult({
      name: 'bash',
      text: 'a.txt\nb.txt\n',
      meta: { cwd: '/repo' },
      failed: false,
    })
    expect(summary.preview).toBe('a.txt')
    expect(summary.output).toBe('a.txt\nb.txt')
    expect(summary.facts).toEqual(['cwd /repo'])
  })

  it('describes a read window from its presentation metadata', () => {
    const summary = summarizeToolResult({
      name: 'read',
      text: '1  a\n2  b',
      meta: {
        path: '/repo/a.ts',
        offset: 1,
        totalLines: 10,
        lines: [{ number: 1, text: 'a' }, { number: 2, text: 'b' }],
      },
      failed: false,
    })
    expect(summary.preview).toBe('2 of 10 lines')
  })

  it('summarizes a diff payload for edit and write results', () => {
    const summary = summarizeToolResult({
      name: 'edit',
      text: 'edited /repo/a.ts',
      meta: {
        path: '/repo/a.ts',
        diffs: [{ path: '/repo/a.ts', oldText: 'one\ntwo', newText: 'one\nthree\nfour' }],
      },
      failed: false,
    })
    expect(summary.preview).toBe('+3 −2')
  })

  it('uses the recorded failure reason when the result text is empty', () => {
    const summary = summarizeToolResult({
      name: 'bash',
      text: '',
      meta: undefined,
      failed: true,
      errorReason: 'the command was denied',
    })
    expect(summary.preview).toBe('the command was denied')
    expect(summary.output).toBe('')
  })

  it('marks a failed result without a message', () => {
    expect(summarizeToolResult({ name: 'bash', text: '', meta: undefined, failed: true }).preview)
      .toBe('failed without a message')
  })

  it('truncates an oversized result for the expanded view', () => {
    const summary = summarizeToolResult({
      name: 'bash',
      text: 'x'.repeat(TOOL_OUTPUT_LIMIT + 100),
      meta: undefined,
      failed: false,
    })
    expect(summary.output.length).toBeLessThan(TOOL_OUTPUT_LIMIT + 20)
    expect(summary.output.endsWith('… truncated')).toBe(true)
  })
})

describe('duration formatting', () => {
  it('formats milliseconds, seconds, and minutes', () => {
    expect(formatDuration(0)).toBe('0ms')
    expect(formatDuration(12.4)).toBe('12ms')
    expect(formatDuration(1_500)).toBe('1.5s')
    expect(formatDuration(45_000)).toBe('45s')
    expect(formatDuration(125_000)).toBe('2m 5s')
  })
})
