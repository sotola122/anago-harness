import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { bindScopeParent, createScope, type Scope, type ScopeKey } from '@deepseek-ai/dsh-scope'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { PERSONA_PREFIX_SECTION } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { commandInvokesBinary } from '../src/command.ts'
import * as Policy from '@deepseek-ai/dsh-orchestrator-policy'
import {
  DENIAL_MESSAGE, ORCHESTRATOR_PERSONA, ORCHESTRATOR_POLICY_SECTION, ORCHESTRATOR_SECTION, STANDARD_PERSONA,
} from '@deepseek-ai/dsh-orchestrator-policy'

const signal = new AbortController().signal
const DENIED = new Set(['claude', 'cursor', 'cursor-agent', 'codex'])

function agentAt(depth: number): Agent {
  return { options: {}, session: { header: { delegationDepth: depth } } } as Agent
}

function shell(name: string, calls: { n: number }): ToolDefinition {
  return {
    name,
    description: name,
    parameters: { type: 'object', properties: { command: { type: 'string' } } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] },
    execute: () => {
      calls.n += 1
      return Promise.resolve('ran')
    },
  }
}

async function mounted(config?: Policy.Config): Promise<{
  ctx: Context
  scope: Scope
  key: ScopeKey
  calls: { n: number }
}> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, { personaPrefix: 'deployment' })
  await ctx.plugin(ToolRuntime)
  ctx.systemPrompt.variable('model', () => 'test-model')
  const key: ScopeKey = { id: 'orchestrator-preset' }
  let scope!: Scope
  await ctx.plugin(Object.assign((inner: Context) => {
    scope = createScope(inner, key)
  }, { inject: ['systemPrompt', 'tools'] }))
  const calls = { n: 0 }
  ctx.tools.register(shell('bash', calls))
  ctx.tools.register(shell('pwsh', calls))
  ctx.tools.register(shell('write', calls))
  await scope.ctx.plugin(Policy, config)
  return { ctx, scope, key, calls }
}

async function run(ctx: Context, name: string, command: string, agent?: Agent): Promise<string> {
  const result = await ctx.tools.execute({
    signal,
    callId: ToolCallId('c1'),
    name,
    arguments: { command, run_in_background: true },
    ...agent === undefined ? {} : { agent },
  })
  const first = result.content[0]
  return first?.type === 'text' ? first.text : JSON.stringify(result.content)
}

async function sectionText(ctx: Context, agent: Agent | undefined, scope: ScopeKey): Promise<string | undefined> {
  const assembly = await ctx.systemPrompt.assemble(agent === undefined ? { scope } : { scope: agent, agent })
  return assembly.sections.find(section => section.name === ORCHESTRATOR_POLICY_SECTION)?.text
}

describe('orchestrator policy', () => {
  it('rejects an unscoped mount and a path in binaries', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime)
    await expect(ctx.plugin(Policy)).rejects.toThrow(/preset scope/)
    const key: ScopeKey = { id: 'bad-binaries' }
    let scope!: Scope
    await ctx.plugin(Object.assign((inner: Context) => {
      scope = createScope(inner, key)
    }, { inject: ['systemPrompt', 'tools'] }))
    await expect(scope.ctx.plugin(Policy, { binaries: ['/usr/bin/claude'] })).rejects.toThrow(/basenames/)
    await expect(scope.ctx.plugin(Policy, { binaries: ['a\\b'] })).rejects.toThrow(/basenames/)
    await expect(scope.ctx.plugin(Policy, { binaries: [''] })).rejects.toThrow(/basenames/)
    expect(Policy.resolveConfig({}).binaries).toEqual(['claude', 'cursor', 'cursor-agent', 'codex'])
  })

  it('shows the contract and persona only at depth 0, and drops both on disposal', async () => {
    const { ctx, scope, key } = await mounted()
    const parent = agentAt(0)
    const child = agentAt(1)
    bindScopeParent(parent, key)
    bindScopeParent(child, key)
    expect(await sectionText(ctx, parent, key)).toBe(ORCHESTRATOR_SECTION)
    expect(await sectionText(ctx, child, key)).toBe('')
    expect(await sectionText(ctx, undefined, key)).toBe('')
    const parentAssembly = await ctx.systemPrompt.assemble({ scope: parent, agent: parent })
    const childAssembly = await ctx.systemPrompt.assemble({ scope: child, agent: child })
    expect(parentAssembly.sections.find(section => section.name === PERSONA_PREFIX_SECTION)?.text).toBe(ORCHESTRATOR_PERSONA)
    expect(childAssembly.sections.find(section => section.name === PERSONA_PREFIX_SECTION)?.text).toBe(STANDARD_PERSONA)
    expect(renderPrompt(parentAssembly)).toContain(ORCHESTRATOR_SECTION)
    expect(renderPrompt(childAssembly)).not.toContain('Split a request')
    expect(ctx.systemPrompt.getSectionOrder('ORCHESTRATOR_POLICY')).toBe(550)
    await scope.dispose()
    expect((await ctx.systemPrompt.assemble({ scope: parent, agent: parent })).sections
      .find(section => section.name === PERSONA_PREFIX_SECTION)?.text).toBe('deployment')
  })

  it('denies direct CLI starts at depth 0 without running the tool, and allows them at depth 1', async () => {
    const { ctx, key, calls } = await mounted()
    const parent = agentAt(0)
    const resumed = { options: {}, session: { header: { delegationDepth: 1 } } } as Agent
    const outsider = agentAt(0)
    bindScopeParent(parent, key)
    bindScopeParent(resumed, key)
    const denied = [
      'claude',
      '/usr/bin/codex exec',
      'timeout 30 cursor agent',
      "bash -c 'claude -p hi'",
      'npx claude',
      'cursor-agent',
      'pwsh -Command claude',
    ]
    for (const command of denied) {
      expect(await run(ctx, 'bash', command, parent)).toBe(`Error: ${DENIAL_MESSAGE}`)
      expect(await run(ctx, 'pwsh', command, parent)).toBe(`Error: ${DENIAL_MESSAGE}`)
    }
    expect(calls.n).toBe(0)
    for (const command of denied) {
      expect(await run(ctx, 'bash', command, resumed)).toBe('ran')
    }
    expect(await run(ctx, 'bash', 'git status', parent)).toBe('ran')
    expect(await run(ctx, 'bash', 'git grep claude', parent)).toBe('ran')
    expect(await run(ctx, 'bash', 'bash ./run.sh', parent)).toBe('ran')
    expect(await run(ctx, 'write', 'claude', parent)).toBe('ran')
    expect(await run(ctx, 'bash', 'claude', outsider)).toBe('ran')
    expect(await run(ctx, 'bash', 'claude')).toBe('ran')
  })

  it('uses a configured denylist and ignores a non-string command', async () => {
    const { ctx, key, calls } = await mounted({ binaries: ['mycli'] })
    const parent = agentAt(0)
    bindScopeParent(parent, key)
    expect(await run(ctx, 'bash', 'claude', parent)).toBe('ran')
    expect(await run(ctx, 'bash', 'mycli --help', parent)).toBe(`Error: ${DENIAL_MESSAGE}`)
    const missing = await ctx.tools.execute({
      signal, callId: ToolCallId('c2'), name: 'bash', arguments: { command: 1 }, agent: parent,
    })
    const absent = await ctx.tools.execute({
      signal, callId: ToolCallId('c3'), name: 'bash', arguments: null, agent: parent,
    })
    expect(missing.isError).toBe(false)
    expect(absent.isError).toBe(false)
    expect(calls.n).toBe(3)
  })

  it('loads as a named plugin through unwrapExports', () => {
    expect('default' in Policy).toBe(false)
    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(Policy) as Record<string, unknown>
    expect(unwrapped).toBe(Policy)
    expect(unwrapped.name).toBe('orchestrator-policy')
    expect(unwrapped.inject).toEqual(['systemPrompt', 'tools'])
    expect(typeof unwrapped.apply).toBe('function')
  })
})

describe('direct CLI matching', () => {
  const hit = (command: string): boolean => commandInvokesBinary(command, DENIED)

  it('matches the stated direct forms and leaves indirect starts alone', () => {
    expect(hit('git status')).toBe(false)
    expect(hit('git grep claude')).toBe(false)
    expect(hit('cat notes/codex.md')).toBe(false)
    expect(hit('bash ./run.sh')).toBe(false)
    expect(hit('claude')).toBe(true)
    expect(hit('/usr/bin/codex exec')).toBe(true)
    expect(hit('timeout 30 cursor agent')).toBe(true)
    expect(hit("bash -c 'claude -p hi'")).toBe(true)
    expect(hit('npx claude')).toBe(true)
    expect(hit('npx -y /usr/bin/claude')).toBe(true)
    expect(hit('bunx claude')).toBe(true)
    expect(hit('npm exec claude')).toBe(true)
    expect(hit('pnpm dlx cursor-agent')).toBe(true)
    expect(hit('yarn dlx codex')).toBe(true)
    expect(hit('npm install claude')).toBe(false)
    expect(hit('env FOO=1 claude')).toBe(true)
    expect(hit('FOO=1 claude')).toBe(true)
    expect(hit('bash -lc \'claude\'')).toBe(true)
    expect(hit('sh -c "claude"')).toBe(true)
    expect(hit('echo $(claude)')).toBe(true)
    expect(hit('echo $(echo \'claude\')')).toBe(false)
    expect(hit("echo $(echo ')')")).toBe(false)
    expect(hit('echo `claude`')).toBe(true)
    expect(hit('echo "$(claude)"')).toBe(true)
    expect(hit('echo "\\$(claude)"')).toBe(false)
    expect(hit('cl\\aude')).toBe(true)
    expect(hit('git status\nclaude')).toBe(true)
    expect(hit('false || claude')).toBe(true)
    expect(hit('true | claude')).toBe(true)
    expect(hit('echo claude &')).toBe(false)
    expect(hit("echo '$(claude)'")).toBe(false)
    expect(hit('timeout --foreground 30 cursor')).toBe(true)
    expect(hit('timeout cursor')).toBe(true)
    expect(hit('nice -n 19 claude')).toBe(false)
    expect(hit('cursor agent')).toBe(true)
    expect(hit('agent')).toBe(false)
    expect(hit('env -i')).toBe(false)
    expect(hit('echo "`claude`"')).toBe(true)
    expect(hit('echo $(echo "a\\"b")')).toBe(false)
    expect(hit('echo $(cl\\aude)')).toBe(true)
    expect(hit('echo $(echo $(claude))')).toBe(true)
    expect(hit('echo `claude')).toBe(true)
    expect(hit('echo $(claude')).toBe(true)
  })
})
