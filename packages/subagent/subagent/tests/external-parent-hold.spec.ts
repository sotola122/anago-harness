/** An external backend run holds its parent against idle release until the run settles. */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SubagentRuntime from '../src/index.ts'
import type { SubagentResult, SubagentRun } from '../src/types.ts'
import { externalTestParent } from './external-activation-helpers.ts'
import { mountWorkingDirectoryFixture } from './working-directory-fixture.ts'

const complete: SubagentResult = { output: [], stopReason: 'completed' }

async function setup(run: () => SubagentRun) {
  const ctx = new Context()
  await ctx.plugin(SessionProjectionRegistry)
  await mountWorkingDirectoryFixture(ctx)
  await ctx.plugin(SubagentRuntime)
  const parent = await externalTestParent(ctx)
  ctx.subagents.registerProvider({
    name: 'external', inheritsParentContext: false,
    capabilities: { agentOptions: false, agentPreset: false, outputSchema: false, depthLimit: false },
    start: () => Promise.resolve(run()),
  })
  return {
    ctx, parent,
    holds: () => ctx.agents.holds(parent),
    start: () => ctx.subagents.startActivation({
      provider: 'external', label: 'External work', signal: new AbortController().signal, delivery: 'parent',
      parent, prompt: [{ type: 'text', text: 'work' }],
    }),
  }
}

describe('external run parent hold', () => {
  it('holds the parent while the run is active and releases it after completion', async () => {
    const result = Promise.withResolvers<SubagentResult>()
    const fixture = await setup(() => ({ id: SessionId('held-run'), result: result.promise, dispose: () => Promise.resolve() }))
    const activation = await fixture.start()
    expect(fixture.holds()).toBe(1)
    result.resolve(complete)
    await activation.result
    await vi.waitFor(() => { expect(fixture.holds()).toBe(0) })
  })

  it('releases the hold only after the settlement notice reached the parent inbox', async () => {
    const result = Promise.withResolvers<SubagentResult>()
    const fixture = await setup(() => ({ id: SessionId('notice-run'), result: result.promise, dispose: () => Promise.resolve() }))
    const activation = await fixture.start()
    let holdsAtNotice: number | undefined
    const original = fixture.parent.followup.bind(fixture.parent)
    fixture.parent.followup = (message) => {
      holdsAtNotice = fixture.holds()
      original(message)
    }
    result.resolve(complete)
    await activation.result
    await vi.waitFor(() => { expect(fixture.holds()).toBe(0) })
    expect(holdsAtNotice).toBe(1)
  })

  it('releases the hold when the run fails', async () => {
    const result = Promise.withResolvers<SubagentResult>()
    const fixture = await setup(() => ({ id: SessionId('failed-run'), result: result.promise, dispose: () => Promise.resolve() }))
    const activation = await fixture.start()
    result.reject(new Error('backend crashed'))
    await expect(activation.result).rejects.toThrow('backend crashed')
    await vi.waitFor(() => { expect(fixture.holds()).toBe(0) })
  })

  it('releases the hold when the run is aborted by disposal', async () => {
    const result = Promise.withResolvers<SubagentResult>()
    const fixture = await setup(() => ({
      id: SessionId('aborted-run'),
      result: result.promise,
      dispose: () => { result.resolve({ output: [], stopReason: 'aborted' }); return Promise.resolve() },
    }))
    const activation = await fixture.start()
    expect(fixture.holds()).toBe(1)
    await activation.dispose()
    expect(fixture.holds()).toBe(0)
  })

  it('does not leak the hold when admission rolls back', async () => {
    const result = Promise.withResolvers<SubagentResult>()
    const dispose = vi.fn(() => { result.resolve({ output: [], stopReason: 'aborted' }); return Promise.resolve() })
    const fixture = await setup(() => ({ id: SessionId('rollback-run'), result: result.promise, dispose }))
    const failure = new Error('catalog unavailable')
    const append = vi.spyOn(fixture.parent.session, 'append').mockImplementationOnce(() => { throw failure })
    try {
      await expect(fixture.start()).rejects.toBe(failure)
      expect(dispose).toHaveBeenCalledOnce()
      expect(fixture.holds()).toBe(0)
    } finally {
      append.mockRestore()
    }
  })

  it('warns when the parent was released before the run finished', async () => {
    const result = Promise.withResolvers<SubagentResult>()
    const fixture = await setup(() => ({ id: SessionId('orphan-run'), result: result.promise, dispose: () => Promise.resolve() }))
    const warning = vi.spyOn(fixture.ctx.logger, 'warn')
    const activation = await fixture.start()
    const get = fixture.ctx.agents.get.bind(fixture.ctx.agents)
    const lookup = vi.spyOn(fixture.ctx.agents, 'get').mockImplementation(id => id === fixture.parent.id ? undefined : get(id))
    result.resolve(complete)
    await activation.result
    await vi.waitFor(() => {
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('result was not delivered'))
    })
    lookup.mockRestore()
    warning.mockRestore()
  })
})
