import { describe, expect, it } from 'vitest'
import { describeToolInvocation, summarizeToolCall, summarizeToolResult } from '../src/projection/tools.ts'

describe('tool invocation fallbacks', () => {
  it('falls back to the raw arguments when the JSON is not an object', () => {
    expect(describeToolInvocation('mystery', 'null').summary).toBe('null')
    expect(describeToolInvocation('mystery', '[]').summary).toBe('[]')
    expect(describeToolInvocation('mystery', '"text"').summary).toBe('"text"')
    expect(describeToolInvocation('mystery', '42').summary).toBe('42')
  })

  it('keeps the description when a shell call has no command', () => {
    expect(describeToolInvocation('bash', JSON.stringify({ description: 'List the tree' })))
      .toEqual({ summary: 'List the tree' })
    expect(describeToolInvocation('bash', JSON.stringify({ cmd: 'ls' }))).toEqual({ summary: 'ls' })
    expect(describeToolInvocation('pwsh', JSON.stringify({ command: 'Get-ChildItem' })))
      .toEqual({ summary: 'Get-ChildItem' })
    expect(describeToolInvocation('bash', JSON.stringify({}))).toEqual({ summary: '{}' })
  })

  it('keeps a filesystem call readable when no path was supplied', () => {
    expect(describeToolInvocation('read', JSON.stringify({ offset: 12 })))
      .toEqual({ summary: '{"offset":12}' })
    for (const name of ['read_image', 'write', 'edit', 'str_replace_editor']) {
      expect(describeToolInvocation(name, JSON.stringify({ content: 'x' })).summary)
        .toBe('{"content":"x"}')
    }
  })

  it('describes search calls with and without a directory', () => {
    expect(describeToolInvocation('grep', JSON.stringify({ pattern: 'TODO' })))
      .toEqual({ summary: 'TODO' })
    expect(describeToolInvocation('glob', JSON.stringify({ query: '**/*.ts' })))
      .toEqual({ summary: '**/*.ts' })
    expect(describeToolInvocation('grep', JSON.stringify({ path: 'src' })))
      .toEqual({ summary: 'src' })
  })

  it('describes web calls from their query or URL', () => {
    expect(describeToolInvocation('web_search', JSON.stringify({ query: 'cordis events' })))
      .toEqual({ summary: 'cordis events' })
    expect(describeToolInvocation('web_search', JSON.stringify({ q: 'waterfall' })))
      .toEqual({ summary: 'waterfall' })
    expect(describeToolInvocation('web_fetch', JSON.stringify({ url: 'https://example.test/a' })))
      .toEqual({ summary: 'https://example.test/a' })
    expect(describeToolInvocation('web_search', JSON.stringify({ limit: 3 })))
      .toEqual({ summary: '{"limit":3}' })
    expect(describeToolInvocation('web_fetch', JSON.stringify({ headers: {} })))
      .toEqual({ summary: '{"headers":{}}' })
  })

  it('counts list-shaped arguments and tolerates missing ones', () => {
    expect(describeToolInvocation('todo_write', JSON.stringify({ todos: [{}, {}, {}] })).summary).toBe('3 items')
    expect(describeToolInvocation('todo_write', JSON.stringify({ todos: 'later' })).summary).toBe('{"todos":"later"}')
    expect(describeToolInvocation('ask_user_question', JSON.stringify({ questions: [{}, {}] })).summary)
      .toBe('2 questions')
    expect(describeToolInvocation('ask_user_question', JSON.stringify({ questions: null })).summary)
      .toBe('{"questions":null}')
    expect(describeToolInvocation('skill', JSON.stringify({ name: 'dsh-doc' })).summary).toBe('dsh-doc')
    expect(describeToolInvocation('skill', JSON.stringify({ files: ['a.md'] })).summary).toBe('a.md')
  })

  it('falls back to the raw arguments when no argument is displayable', () => {
    expect(describeToolInvocation('mystery', JSON.stringify({ target: 'x' })).summary).toBe('{"target":"x"}')
    expect(describeToolInvocation('mystery', JSON.stringify({ items: [1, 2] })).summary)
      .toBe('{"items":[1,2]}')
    expect(summarizeToolCall('mystery', JSON.stringify({ nested: { deep: true } })))
      .toBe('{"nested":{"deep":true}}')
  })
})

describe('tool result metadata', () => {
  it('counts every changed file in a multi-file diff', () => {
    const summary = summarizeToolResult({
      name: 'edit',
      text: 'edited two files',
      meta: {
        diffs: [
          { oldText: 'one', newText: 'one\ntwo' },
          { oldText: '', newText: 'three' },
        ],
      },
      failed: false,
    })

    expect(summary.preview).toBe('+2 −1 · 2 files')
  })

  it('reports an empty diff without inventing line counts', () => {
    const summary = summarizeToolResult({
      name: 'edit',
      text: 'touched nothing',
      meta: { diffs: [{}] },
      failed: false,
    })

    expect(summary.preview).toBe('+0 −0')
  })

  it('describes a read window without a known total', () => {
    const summary = summarizeToolResult({
      name: 'read',
      text: '1  a\n2  b',
      meta: { lines: [{ number: 1 }, { number: 2 }] },
      failed: false,
    })

    expect(summary.preview).toBe('2 lines')
  })

  it('names a job from its presentation metadata', () => {
    const summary = summarizeToolResult({
      name: 'bash',
      text: 'started the job',
      meta: { jobId: 'job-7', operation: 'spawn', exitCode: 2 },
      failed: false,
    })

    expect(summary.preview).toBe('job job-7')
    expect(summary.facts).toEqual(['operation spawn', 'job job-7', 'exit 2'])
  })

  it('falls back to "no output" for a successful empty result', () => {
    expect(summarizeToolResult({ name: 'bash', text: '  ', meta: undefined, failed: false }).preview)
      .toBe('no output')
  })
})
