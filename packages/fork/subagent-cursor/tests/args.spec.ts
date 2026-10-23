import { describe, expect, it } from 'vitest'
import {
  CLI_AGENT_SUBCOMMAND,
  CLI_SUBCOMMAND_NAMES,
  MAX_TASK_BYTES,
  RESERVED_FLAGS,
  assertNoReservedArgs,
  assertTaskText,
  buildArgv,
  flattenPrompt,
} from '../src/args.ts'
import type { ArgvOptions } from '../src/args.ts'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'

const CWD = '/workspace/child'

/** Default provider-owned options: the posture the design fixes. */
function options(overrides: Partial<ArgvOptions> = {}): ArgvOptions {
  return {
    outputFormat: 'json',
    sandbox: true,
    trust: true,
    force: false,
    mode: 'agent',
    ...overrides,
  }
}

describe('buildArgv', () => {
  it('emits the documented flag order for the default run', () => {
    expect(buildArgv(options(), 'summarize the repo', CWD)).toEqual([
      '--print',
      '--output-format',
      'json',
      '--sandbox',
      'enabled',
      '--trust',
      '--workspace',
      CWD,
      'agent',
      'summarize the repo',
    ])
  })

  it('spells the CLI agent command between the options and the task', () => {
    const argv = buildArgv(options(), 'summarize the repo', CWD)
    expect(argv.slice(-2)).toEqual([CLI_AGENT_SUBCOMMAND, 'summarize the repo'])
    // The command word is an operand: every option precedes it.
    expect(argv.indexOf(CLI_AGENT_SUBCOMMAND)).toBeGreaterThan(argv.indexOf('--workspace'))
    expect(argv.filter(arg => arg === CLI_AGENT_SUBCOMMAND)).toHaveLength(1)
  })

  it('places a task that leads with a subcommand name after the agent command', () => {
    for (const task of ['help me fix the failing test', 'logout now', 'update the changelog']) {
      expect(buildArgv(options(), task, CWD).slice(-2)).toEqual([CLI_AGENT_SUBCOMMAND, task])
    }
  })

  it('keeps the agent command in place for every option combination', () => {
    const argv = buildArgv(
      options({ mode: 'plan', model: 'sonnet-4-thinking', force: true, sandbox: false, trust: false }),
      'task',
      CWD,
    )
    expect(argv.slice(-2)).toEqual([CLI_AGENT_SUBCOMMAND, 'task'])
    expect(argv.indexOf(CLI_AGENT_SUBCOMMAND)).toBeGreaterThan(argv.indexOf('--force'))
  })

  it('omits --mode for agent mode and adds it for ask and plan', () => {
    expect(buildArgv(options({ mode: 'agent' }), 'task', CWD)).not.toContain('--mode')
    expect(buildArgv(options({ mode: 'ask' }), 'task', CWD)).toContain('--mode')
    expect(buildArgv(options({ mode: 'ask' }), 'task', CWD).slice(-4, -2)).toEqual(['--mode', 'ask'])
    expect(buildArgv(options({ mode: 'plan' }), 'task', CWD).slice(-4, -2)).toEqual(['--mode', 'plan'])
  })

  it('passes sandbox=disabled only when sandbox is false', () => {
    expect(buildArgv(options({ sandbox: false }), 'task', CWD).slice(3, 5)).toEqual([
      '--sandbox',
      'disabled',
    ])
  })

  it('omits --trust when trust is false', () => {
    expect(buildArgv(options({ trust: false }), 'task', CWD)).not.toContain('--trust')
  })

  it('adds --force only when force is explicitly enabled', () => {
    expect(buildArgv(options(), 'task', CWD)).not.toContain('--force')
    expect(buildArgv(options({ force: true }), 'task', CWD)).toContain('--force')
    // --force sits after the workspace/mode/model flags and before the command word.
    expect(buildArgv(options({ force: true }), 'task', CWD).slice(-3, -1)).toEqual([
      '--force',
      CLI_AGENT_SUBCOMMAND,
    ])
  })

  it('adds --model only when a model is configured', () => {
    expect(buildArgv(options(), 'task', CWD)).not.toContain('--model')
    expect(buildArgv(options({ model: 'sonnet-4-thinking' }), 'task', CWD).slice(-4, -1)).toEqual([
      '--model',
      'sonnet-4-thinking',
      CLI_AGENT_SUBCOMMAND,
    ])
  })

  it('appends extraArgs after the provider-owned flags and before the command word', () => {
    const argv = buildArgv(options({ extraArgs: ['--stream-partial-output'] }), 'task', CWD)
    expect(argv.slice(-3)).toEqual(['--stream-partial-output', CLI_AGENT_SUBCOMMAND, 'task'])
    expect(argv.indexOf('--workspace')).toBeLessThan(argv.indexOf('--stream-partial-output'))
  })
})

describe('extraArgs conflicts', () => {
  it('rejects every provider-owned flag, including its documented aliases', () => {
    for (const flag of RESERVED_FLAGS) {
      expect(() =>{  assertNoReservedArgs([flag]) }).toThrow(/provider-owned flag/)
    }
  })

  it('rejects the --flag=value spelling of a provider-owned flag', () => {
    expect(() =>{  assertNoReservedArgs(['--sandbox=disabled']) }).toThrow(/"--sandbox"/)
    expect(() =>{  assertNoReservedArgs(['--mode=plan']) }).toThrow(/"--mode"/)
    expect(() =>{  assertNoReservedArgs(['--output-format=json']) }).toThrow(/"--output-format"/)
  })

  it('rejects a conflict anywhere in the list and refuses it before spawning', () => {
    expect(() =>{  assertNoReservedArgs(['--stream-partial-output', '/tmp', '--force']) }).toThrow(/"--force"/)
    expect(() => buildArgv(options({ extraArgs: ['--yolo'] }), 'task', CWD)).toThrow(/--yolo/)
    expect(() => buildArgv(options({ extraArgs: ['--print'] }), 'task', CWD)).toThrow(/--print/)
  })

  it('rejects the CLI connectivity, reach and session flags the provider owns', () => {
    const cases: readonly (readonly string[])[] = [
      ['-e', 'https://evil.example'],
      ['--endpoint=https://evil.example'],
      ['--api-key=sk-live-1234567890'],
      ['--header', 'X-Api-Key: abc'],
      ['-H', 'X-Api-Key: abc'],
      ['--add-dir', '/tmp/x'],
      ['--worktree', 'other'],
      ['-w'],
      ['--plugin-dir', '/tmp/p'],
      ['--approve-mcps'],
      ['--continue'],
      ['--resume'],
    ]
    for (const extra of cases) {
      expect(() =>{  assertNoReservedArgs(extra) }).toThrow(/provider-owned flag/)
    }
    expect(() => buildArgv(options({ extraArgs: ['-e', 'https://evil.example'] }), 'task', CWD)).toThrow(
      /"-e"/,
    )
    expect(() => buildArgv(options({ extraArgs: ['--api-key=sk-live-1234567890'] }), 'task', CWD)).toThrow(
      /"--api-key"/,
    )
    expect(() => buildArgv(options({ extraArgs: ['-w'] }), 'task', CWD)).toThrow(/"-w"/)
  })

  it('rejects a clustered short option that hides a provider-owned flag', () => {
    expect(() =>{  assertNoReservedArgs(['-pf']) }).toThrow(/"-p".*"-pf"/)
    expect(() =>{  assertNoReservedArgs(['-fp']) }).toThrow(/"-f".*"-fp"/)
    expect(() =>{  assertNoReservedArgs(['-ehttps://evil.example']) }).toThrow(/"-e".*"-ehttps/)
    expect(() =>{  assertNoReservedArgs(['-Hx-api-key:abc']) }).toThrow(/"-H".*"-Hx-api-key:abc"/)
    expect(() =>{  assertNoReservedArgs(['-wother']) }).toThrow(/"-w".*"-wother"/)
    expect(() => buildArgv(options({ extraArgs: ['-pf'] }), 'task', CWD)).toThrow(/provider-owned flag/)
  })

  it('accepts arguments that do not restate a provider-owned flag', () => {
    expect(() =>{  assertNoReservedArgs(['--stream-partial-output']) }).not.toThrow()
    // Unknown short options are not silently mapped onto a reserved letter.
    expect(() =>{  assertNoReservedArgs(['-x']) }).not.toThrow()
  })
})

describe('task validation', () => {
  it('rejects a task that begins with "-" in both entry points', () => {
    expect(() =>{  assertTaskText('--force the build') }).toThrow(/must not begin with "-"/)
    expect(() => flattenPrompt([{ type: 'text', text: '- fix the bug' }])).toThrow(/must not begin with "-"/)
    expect(() => buildArgv(options(), '--yolo', CWD)).toThrow(/must not begin with "-"/)
  })

  it('rejects an empty or whitespace-only task', () => {
    expect(() =>{  assertTaskText('   ') }).toThrow(/must not be empty/)
    expect(() => flattenPrompt([])).toThrow(/must not be empty/)
  })

  it('rejects a task above the argv byte budget', () => {
    const tooLong = 'あ'.repeat(Math.ceil((MAX_TASK_BYTES + 1) / 3))
    expect(Buffer.byteLength(tooLong, 'utf8')).toBeGreaterThan(MAX_TASK_BYTES)
    expect(() =>{  assertTaskText(tooLong) }).toThrow(/must not exceed/)
    expect(() =>{  assertTaskText('a'.repeat(MAX_TASK_BYTES)) }).not.toThrow()
  })

  it('flattens text blocks in order and rejects non-text blocks', () => {
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'first ' },
      { type: 'text', text: 'second' },
    ]
    expect(flattenPrompt(blocks)).toBe('first second')
    const withImage = [{ type: 'text', text: 'a' }, { type: 'image' }] as ContentBlock[]
    expect(() => flattenPrompt(withImage)).toThrow(/only text blocks/)
  })
})

describe('task / CLI subcommand collision', () => {
  it('rejects a task that is exactly one of the CLI subcommand names', () => {
    for (const name of CLI_SUBCOMMAND_NAMES) {
      expect(() =>{  assertTaskText(name) }).toThrow(/collides with the Cursor CLI subcommand/)
    }
    expect(CLI_SUBCOMMAND_NAMES).toContain('logout')
    expect(CLI_SUBCOMMAND_NAMES).toContain('update')
    expect(CLI_SUBCOMMAND_NAMES).toContain('whoami')
    expect(CLI_SUBCOMMAND_NAMES).toContain('rule')
  })

  it('matches case-insensitively after trimming surrounding whitespace', () => {
    expect(() =>{  assertTaskText('LOGOUT') }).toThrow(/subcommand "logout"/)
    expect(() =>{  assertTaskText('  Update  ') }).toThrow(/subcommand "update"/)
    expect(() =>{  assertTaskText('\tWhoAmI\n') }).toThrow(/subcommand "whoami"/)
    expect(() =>{  assertTaskText('Install-Shell-Integration') }).toThrow(/subcommand "install-shell-integration"/)
  })

  it('fails closed in both entry points, before any process starts', () => {
    expect(() => flattenPrompt([{ type: 'text', text: 'logout' }])).toThrow(/collides with the Cursor CLI subcommand/)
    expect(() => buildArgv(options(), 'login', CWD)).toThrow(/collides with the Cursor CLI subcommand "login"/)
    expect(() =>
      buildArgv(options({ extraArgs: ['--stream-partial-output'] }), 'update', CWD),
    ).toThrow(/collides/)
  })

  it('never lets any subcommand name reach the command slot of argv', () => {
    // Every name is either refused outright (see below) or, when it only leads
    // the task, placed after the explicit `agent` command word.
    for (const name of CLI_SUBCOMMAND_NAMES) {
      const task = `${name} and then summarise the diff`
      expect(flattenPrompt([{ type: 'text', text: task }])).toBe(task)
      expect(buildArgv(options(), task, CWD).slice(-2)).toEqual([CLI_AGENT_SUBCOMMAND, task])
    }
    expect(CLI_AGENT_SUBCOMMAND).toBe('agent')
  })

  it('still accepts a task that merely mentions a subcommand name', () => {
    expect(() =>{  assertTaskText('resume the interrupted upload') }).not.toThrow()
    expect(() =>{  assertTaskText('logout the stale sessions') }).not.toThrow()
    expect(() =>{  assertTaskText('update the changelog') }).not.toThrow()
    expect(() =>{  assertTaskText('explain what agent status does') }).not.toThrow()
    expect(flattenPrompt([{ type: 'text', text: 'ls the directory' }])).toBe('ls the directory')
  })

  it('keeps the dash and byte-budget rejections intact', () => {
    expect(() =>{  assertTaskText('--force') }).toThrow(/must not begin with "-"/)
    expect(() =>{  assertTaskText('') }).toThrow(/must not be empty/)
    expect(() =>{  assertTaskText('a'.repeat(MAX_TASK_BYTES + 1)) }).toThrow(/must not exceed/)
  })
})
