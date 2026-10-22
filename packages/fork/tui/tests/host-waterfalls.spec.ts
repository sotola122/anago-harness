import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { registerApprovalWaterfall, registerQuestionsWaterfall } from '../src/host/waterfalls.ts'

/** The Agent identity the waterfall compares against. */
const AGENT = { id: 'agent-1' }

/** An approval request addressed to {@link AGENT}. */
const APPROVAL = { agent: AGENT, toolName: 'bash', reason: 'write build output' } as never

/** A question batch addressed to {@link AGENT}. */
const QUESTIONS = {
  agent: AGENT,
  questions: [{ id: 'q1', question: 'Continue?' }],
} as never

describe('approval waterfall answerer', () => {
  it('delegates when no Agent is open', async () => {
    const ctx = new Context()
    const askApproval = vi.fn()
    registerApprovalWaterfall(ctx, () => null, () => ({ askApproval }))
    const next = vi.fn(() => 'unavailable' as const)

    await expect(Promise.resolve(ctx.waterfall('approval/request', APPROVAL, next))).resolves.toBe('unavailable')

    expect(next).toHaveBeenCalledTimes(1)
    expect(askApproval).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('delegates a request addressed to another Agent', async () => {
    const ctx = new Context()
    const askApproval = vi.fn()
    registerApprovalWaterfall(
      ctx,
      () => AGENT as never,
      () => ({ askApproval }),
    )
    const next = vi.fn(() => 'unavailable' as const)

    await expect(Promise.resolve(ctx.waterfall(
      'approval/request',
      { agent: { id: 'agent-2' }, toolName: 'bash' } as never,
      next,
    ))).resolves.toBe('unavailable')

    expect(next).toHaveBeenCalledTimes(1)
    expect(askApproval).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('delegates until the renderer has started', async () => {
    const ctx = new Context()
    registerApprovalWaterfall(ctx, () => AGENT as never, () => null)
    const next = vi.fn(() => 'unavailable' as const)

    await expect(Promise.resolve(ctx.waterfall('approval/request', APPROVAL, next))).resolves.toBe('unavailable')

    expect(next).toHaveBeenCalledTimes(1)
    await ctx.fiber.dispose()
  })

  it('answers a request owned by the open Agent', async () => {
    const ctx = new Context()
    const askApproval = vi.fn(async () => 'allowed-once' as const)
    registerApprovalWaterfall(ctx, () => AGENT as never, () => ({ askApproval }))
    const next = vi.fn(() => 'unavailable' as const)

    await expect(Promise.resolve(ctx.waterfall('approval/request', APPROVAL, next))).resolves.toBe('allowed-once')

    expect(askApproval).toHaveBeenCalledWith(APPROVAL)
    expect(next).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })
})

describe('user-questions waterfall answerer', () => {
  it('delegates when no Agent is open', async () => {
    const ctx = new Context()
    const askQuestions = vi.fn()
    registerQuestionsWaterfall(ctx, () => null, () => ({ askQuestions }))
    const next = vi.fn(() => null)

    await expect(Promise.resolve(ctx.waterfall('user-questions/request', QUESTIONS, next))).resolves.toBeNull()

    expect(next).toHaveBeenCalledTimes(1)
    expect(askQuestions).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('delegates a request addressed to another Agent', async () => {
    const ctx = new Context()
    const askQuestions = vi.fn()
    registerQuestionsWaterfall(ctx, () => AGENT as never, () => ({ askQuestions }))
    const next = vi.fn(() => null)

    await expect(Promise.resolve(ctx.waterfall(
      'user-questions/request',
      { agent: { id: 'agent-2' }, questions: [] } as never,
      next,
    ))).resolves.toBeNull()

    expect(next).toHaveBeenCalledTimes(1)
    expect(askQuestions).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('answers an unattributed request when the renderer is live', async () => {
    const ctx = new Context()
    const answer = { answers: [{ id: 'q1', selected: ['Yes'] }] }
    const askQuestions = vi.fn(async () => answer)
    registerQuestionsWaterfall(ctx, () => AGENT as never, () => ({ askQuestions }))
    const next = vi.fn(() => null)
    const request = { questions: [{ id: 'q1', question: 'Continue?' }] } as never

    await expect(Promise.resolve(ctx.waterfall('user-questions/request', request, next))).resolves.toBe(answer)

    expect(askQuestions).toHaveBeenCalledWith(request)
    expect(next).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('delegates while the renderer has not started', async () => {
    const ctx = new Context()
    registerQuestionsWaterfall(ctx, () => AGENT as never, () => null)
    const next = vi.fn(() => null)

    await expect(Promise.resolve(ctx.waterfall('user-questions/request', QUESTIONS, next))).resolves.toBeNull()

    expect(next).toHaveBeenCalledTimes(1)
    await ctx.fiber.dispose()
  })

  it('delegates when the presenter defers the question', async () => {
    const ctx = new Context()
    const askQuestions = vi.fn(async () => null)
    registerQuestionsWaterfall(ctx, () => AGENT as never, () => ({ askQuestions }))
    const next = vi.fn(() => null)

    await expect(Promise.resolve(ctx.waterfall('user-questions/request', QUESTIONS, next))).resolves.toBeNull()

    expect(askQuestions).toHaveBeenCalledTimes(1)
    expect(next).toHaveBeenCalledTimes(1)
    await ctx.fiber.dispose()
  })
})
