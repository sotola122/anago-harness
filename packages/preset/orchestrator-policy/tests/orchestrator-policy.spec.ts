import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { bindScopeParent, createScope, type Scope, type ScopeKey } from '@deepseek-ai/dsh-scope'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { PERSONA_PREFIX_SECTION } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolDefinition } from '@deepseek-ai/dsh-tools'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { commandInvokesBinary } from '../src/command.ts'
import * as Policy from '@deepseek-ai/dsh-orchestrator-policy'
import {
  DENIAL_MESSAGE, ORCHESTRATOR_PERSONA, ORCHESTRATOR_POLICY_SECTION, ORCHESTRATOR_SECTION, STANDARD_PERSONA,
  orchestratorSection,
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

function policyConfig(overrides: Partial<Policy.Config> = {}): Policy.Config {
  return {
    binaries: ['claude', 'cursor', 'cursor-agent', 'codex'],
    promptSkills: ['writing-for-agents'],
    childSkills: ['ponytail'],
    ...overrides,
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
  await ctx.plugin(NativeToolExecutor)
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
    calls: [{
      type: 'tool-call',
      id: ToolCallId('c1'),
      name,
      arguments: JSON.stringify({ command, run_in_background: true }),
    }],
    ...agent === undefined ? {} : { agent },
  })
  const content = result.results[0]?.result.content ?? []
  const first = content[0]
  return first?.type === 'text' ? first.text : JSON.stringify(content)
}

async function sectionText(ctx: Context, agent: Agent | undefined, scope: ScopeKey): Promise<string | undefined> {
  const assembly = await ctx.systemPrompt.assemble(agent === undefined ? { scope } : { scope: agent, agent })
  return assembly.sections.find(section => section.name === ORCHESTRATOR_POLICY_SECTION)?.text
}

describe('orchestrator policy', () => {
  it('rejects an unscoped mount, a path in binaries, and a blank skill name', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime)
    await expect(ctx.plugin(Policy)).rejects.toThrow(/preset scope/)
    const key: ScopeKey = { id: 'bad-binaries' }
    let scope!: Scope
    await ctx.plugin(Object.assign((inner: Context) => {
      scope = createScope(inner, key)
    }, { inject: ['systemPrompt', 'tools'] }))
    await expect(scope.ctx.plugin(Policy, policyConfig({ binaries: ['/usr/bin/claude'] }))).rejects.toThrow(/basenames/)
    await expect(scope.ctx.plugin(Policy, policyConfig({ binaries: ['a\\b'] }))).rejects.toThrow(/basenames/)
    await expect(scope.ctx.plugin(Policy, policyConfig({ binaries: [''] }))).rejects.toThrow(/basenames/)
    await expect(scope.ctx.plugin(Policy, policyConfig({ promptSkills: [''] }))).rejects.toThrow(/promptSkills/)
    await expect(scope.ctx.plugin(Policy, policyConfig({ promptSkills: ['  \t'] }))).rejects.toThrow(/promptSkills/)
    await expect(scope.ctx.plugin(Policy, policyConfig({ childSkills: [''] }))).rejects.toThrow(/childSkills/)
    await expect(scope.ctx.plugin(Policy, policyConfig({ childSkills: [' \n'] }))).rejects.toThrow(/childSkills/)
    expect(Policy.resolveConfig({}).binaries).toEqual(['claude', 'cursor', 'cursor-agent', 'codex'])
    expect(Policy.resolveConfig({}).promptSkills).toEqual(['writing-for-agents'])
    expect(Policy.resolveConfig({}).childSkills).toEqual(['ponytail'])
  })

  it('names configured skills in the delegation paragraph and omits an empty list', async () => {
    const defaults = await mounted()
    const defaultParent = agentAt(0)
    bindScopeParent(defaultParent, defaults.key)
    const defaultText = await sectionText(defaults.ctx, defaultParent, defaults.key)
    expect(defaultText).toBe(ORCHESTRATOR_SECTION)
    expect(defaultText).toContain('Before composing a child prompt, load writing-for-agents with the skill tool and follow it.')
    expect(defaultText).toContain('In every implementation child prompt, tell the child to load ponytail with the skill tool before it changes code.')

    const overridden = await mounted(policyConfig({ promptSkills: ['alpha', 'beta'], childSkills: ['gamma'] }))
    const overrideParent = agentAt(0)
    bindScopeParent(overrideParent, overridden.key)
    const overrideText = await sectionText(overridden.ctx, overrideParent, overridden.key)
    expect(overrideText).toBe(orchestratorSection({ promptSkills: ['alpha', 'beta'], childSkills: ['gamma'] }))
    expect(overrideText).toContain('Before composing a child prompt, load alpha and beta with the skill tool and follow each.')
    expect(overrideText).toContain('In every implementation child prompt, tell the child to load gamma with the skill tool before it changes code.')
    expect(overrideText).not.toContain('writing-for-agents')
    expect(overrideText).not.toContain('ponytail')

    const emptied = await mounted(policyConfig({ promptSkills: [], childSkills: [] }))
    const emptyParent = agentAt(0)
    bindScopeParent(emptyParent, emptied.key)
    const emptyText = await sectionText(emptied.ctx, emptyParent, emptied.key)
    expect(emptyText).toBe(orchestratorSection({ promptSkills: [], childSkills: [] }))
    expect(emptyText).not.toContain('Before composing a child prompt')
    expect(emptyText).not.toContain('implementation child prompt')
    expect(emptyText).not.toContain('skill tool')
    expect(emptyText).toContain('Split a request into tasks and delegate each task with the subagent tool.')
    expect(emptyText).toContain('create_goal continues this same session, so it does not replace a delegation.')

    const promptOnly = await mounted(policyConfig({ childSkills: [] }))
    const promptParent = agentAt(0)
    bindScopeParent(promptParent, promptOnly.key)
    const promptOnlyText = await sectionText(promptOnly.ctx, promptParent, promptOnly.key)
    expect(promptOnlyText).toContain('load writing-for-agents with the skill tool and follow it.')
    expect(promptOnlyText).not.toContain('implementation child prompt')
    expect(promptOnlyText).not.toMatch(/load\s+with the skill tool/)
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
    const { ctx, key, calls } = await mounted(policyConfig({ binaries: ['mycli'] }))
    const parent = agentAt(0)
    bindScopeParent(parent, key)
    expect(await run(ctx, 'bash', 'claude', parent)).toBe('ran')
    expect(await run(ctx, 'bash', 'mycli --help', parent)).toBe(`Error: ${DENIAL_MESSAGE}`)
    const missing = await ctx.tools.execute({
      signal,
      calls: [{ type: 'tool-call', id: ToolCallId('c2'), name: 'bash', arguments: JSON.stringify({ command: 1 }) }],
      agent: parent,
    })
    const absent = await ctx.tools.execute({
      signal,
      calls: [{ type: 'tool-call', id: ToolCallId('c3'), name: 'bash', arguments: 'null' }],
      agent: parent,
    })
    expect(missing.results[0]?.result.isError).toBe(false)
    expect(absent.results[0]?.result.isError).toBe(false)
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
