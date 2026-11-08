/** Per-run permission mode argument for providers that declare selectable modes. */
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  NO_START_CAPABILITIES,
  type SubagentProvider,
  type SubagentStartRequest,
} from '@deepseek-ai/dsh-subagent'
import { MockAdapter } from '../../../core/agent-loop/tests/mock-adapter.ts'
import type { PurposeRoute, PurposeRouteTable } from '../src/purpose-routing.ts'
import { callSubagent, setup, text } from './harness.ts'

const effort = ReasoningEffortId('high')

function modalProvider(
  modes: readonly string[] | undefined,
  defaultMode: string | undefined,
  onStart: (request: SubagentStartRequest) => void,
): SubagentProvider {
  return {
    name: 'modal',
    capabilities: NO_START_CAPABILITIES,
    inheritsParentContext: false,
    ...modes === undefined ? {} : { permissionModes: modes },
    ...defaultMode === undefined ? {} : { defaultPermissionMode: defaultMode },
    start: (request) => {
      onStart(request)
      return Promise.resolve({
        id: SessionId(randomUUID()),
        result: Promise.resolve({ output: [], stopReason: 'completed' as const }),
        dispose: () => Promise.resolve(),
      })
    },
  }
}

async function setupModal(
  modes: readonly string[] | undefined,
  defaultMode: string | undefined,
  seen: SubagentStartRequest[],
): Promise<Context> {
  const ctx = await setup({ provider: 'modal', maxDepth: 'provider-managed' })
  ctx.effect(() => ctx.subagents.registerProvider(
    modalProvider(modes, defaultMode, (request) => { seen.push(request) }),
  ))
  return ctx
}

async function parameters(ctx: Context): Promise<Record<string, { enum?: string[]; description?: string }>> {
  const agent = (await ctx.agents.create({ sessionId: SessionId('permission-schema-agent') })).agent
  const schema = ctx.tools.schemas(agent).find(candidate => candidate.name === 'subagent')
  return (schema?.parameters as { properties: Record<string, { enum?: string[]; description?: string }> }).properties
}

describe('permission_mode argument', () => {
  it('stays out of the schema when the provider offers one mode or none', async () => {
    const single = await setupModal(['dontAsk'], 'dontAsk', [])
    expect(await parameters(single)).not.toHaveProperty('permission_mode')
    const none = await setupModal(undefined, undefined, [])
    expect(await parameters(none)).not.toHaveProperty('permission_mode')
  })

  it('lists the allowed modes and the default when the provider offers several', async () => {
    const ctx = await setupModal(['dontAsk', 'auto', 'plan'], 'auto', [])
    const mode = (await parameters(ctx))['permission_mode']
    expect(mode?.enum).toEqual(['dontAsk', 'auto', 'plan'])
    expect(mode?.description).toContain('Omit for `auto`')
  })

  it('passes the chosen mode to the provider and echoes it on a second line', async () => {
    const seen: SubagentStartRequest[] = []
    const ctx = await setupModal(['dontAsk', 'auto'], 'dontAsk', seen)
    const result = await callSubagent(ctx, {
      prompt: 'edit it',
      description: 'edit task',
      permission_mode: 'auto',
    })
    expect(result.isError).toBe(false)
    expect(seen[0]?.permissionMode).toBe('auto')
    const lines = text(result).split('\n')
    expect(lines[0]).toMatch(/^started subagent \S+$/)
    expect(lines[1]).toBe('permission mode: auto')
  })

  it('leaves the request mode unset and echoes the provider default when omitted', async () => {
    const seen: SubagentStartRequest[] = []
    const ctx = await setupModal(['dontAsk', 'auto'], 'dontAsk', seen)
    const result = await callSubagent(ctx, { prompt: 'read it', description: 'read task' })
    expect(seen[0]).not.toHaveProperty('permissionMode')
    expect(text(result).split('\n')[1]).toBe('permission mode: dontAsk')
  })

  it('keeps the receipt a single line for a single-mode provider', async () => {
    const seen: SubagentStartRequest[] = []
    const ctx = await setupModal(['dontAsk'], 'dontAsk', seen)
    const result = await callSubagent(ctx, { prompt: 'read it', description: 'read task' })
    expect(text(result)).toMatch(/^started subagent \S+$/)
  })

  it('rejects a mode outside the schema enum before starting the provider', async () => {
    const seen: SubagentStartRequest[] = []
    const ctx = await setupModal(['dontAsk', 'auto'], 'dontAsk', seen)
    const result = await callSubagent(ctx, {
      prompt: 'edit it',
      description: 'edit task',
      permission_mode: 'bypassPermissions',
    })
    expect(result.isError).toBe(true)
    expect(seen).toHaveLength(0)
  })
})

describe('permission_mode argument under purpose routing', () => {
  const reasoning = { efforts: [{ id: effort, name: effort }], defaultEffort: effort }
  const route = (model: string) => ({ provider: 'alpha', model, reasoningEffort: effort })
  const table = (review: PurposeRoute[]): PurposeRouteTable => ({
    light: [route('light-model')],
    medium: [route('medium-model')],
    deep: [route('deep-model')],
    review,
    writing: [route('writing-model')],
    default: [route('default-model')],
  })

  /** A mode-declaring provider that also takes the per-child route purpose routing resolves. */
  async function setupRouted(review: PurposeRoute[], seen: SubagentStartRequest[]): Promise<Context> {
    const ctx = await setup({
      provider: 'modal',
      maxDepth: 'provider-managed',
      purposeRouting: true,
      purposeRoutes: table(review),
    })
    ctx.llm.registerAdapter(['alpha'], new MockAdapter([], reasoning))
    ctx.effect(() => ctx.subagents.registerProvider({
      ...modalProvider(['dontAsk', 'plan'], 'dontAsk', (request) => { seen.push(request) }),
      capabilities: { ...NO_START_CAPABILITIES, agentOptions: true },
    }))
    return ctx
  }

  it('passes the chosen mode to the provider and echoes it for a category', async () => {
    const seen: SubagentStartRequest[] = []
    const ctx = await setupRouted([route('review-model')], seen)
    const result = await callSubagent(ctx, {
      prompt: 'plan it',
      description: 'plan task',
      category: 'light',
      permission_mode: 'plan',
    })
    expect(result.isError).toBe(false)
    expect(seen.map(request => request.permissionMode)).toEqual(['plan'])
    expect(text(result).split('\n').at(-1)).toBe('permission mode: plan')
    expect(result.meta).toMatchObject({ permissionMode: 'plan', category: 'light' })
  })

  it('applies the chosen mode to every reviewer of a fan-out and echoes it once', async () => {
    const seen: SubagentStartRequest[] = []
    const ctx = await setupRouted([route('review-one'), route('review-two')], seen)
    const result = await callSubagent(ctx, {
      prompt: 'review it',
      description: 'review task',
      category: 'review',
      permission_mode: 'plan',
    })
    expect(seen.map(request => request.permissionMode)).toEqual(['plan', 'plan'])
    expect(text(result).match(/permission mode: plan/gu)).toHaveLength(1)
  })

  it('leaves the request mode unset and echoes the provider default when omitted', async () => {
    const seen: SubagentStartRequest[] = []
    const ctx = await setupRouted([route('review-model')], seen)
    const result = await callSubagent(ctx, { prompt: 'do it', description: 'default task' })
    expect(seen[0]).not.toHaveProperty('permissionMode')
    expect(text(result).split('\n').at(-1)).toBe('permission mode: dontAsk')
  })
})
