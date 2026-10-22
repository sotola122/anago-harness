import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { listSessionOptions } from '../src/host/sessions.ts'

/** The header fields the picker reads. */
interface FakeHeader {
  readonly id: string
  readonly createdAt: number
  readonly cwd?: string
  readonly origin?: string
}

/**
 * Provide a fake `sessionQuery` service over fixed Session headers.
 * @param ctx - context receiving the service.
 * @param headers - stored Session headers in store order.
 */
function provideSessions(ctx: Context, headers: readonly FakeHeader[]): void {
  ctx.provide('sessionQuery', {
    listSessions: async () => headers.map(header => ({
      header: { ...header, id: SessionId(header.id) },
    })),
  } as never)
}

describe('stored Session listing', () => {
  it('refuses the picker when the profile mounts no sessionQuery service', async () => {
    const ctx = new Context()

    await expect(listSessionOptions(ctx, undefined))
      .rejects.toThrow(/requires the sessionQuery service/)
    await ctx.fiber.dispose()
  })

  it('maps headers to picker rows and marks the Session the UI shows', async () => {
    const ctx = new Context()
    provideSessions(ctx, [
      { id: 'session-a', createdAt: 300, cwd: '/repo/anago' },
      { id: 'session-b', createdAt: 200 },
      { id: 'session-c', createdAt: 100, cwd: '' },
    ])

    const options = await listSessionOptions(ctx, 'session-b')

    expect(options).toEqual([
      { id: 'session-a', createdAt: 300, cwd: '/repo/anago', current: false },
      { id: 'session-b', createdAt: 200, current: true },
      { id: 'session-c', createdAt: 100, cwd: '', current: false },
    ])
    await ctx.fiber.dispose()
  })

  it('omits subagent Sessions and caps the list at the fifty newest', async () => {
    const ctx = new Context()
    const headers: FakeHeader[] = []
    headers.push({ id: 'subagent-child', createdAt: 1_000, origin: 'subagent' })
    for (let index = 0; index < 60; index += 1) {
      headers.push({ id: `session-${String(index).padStart(2, '0')}`, createdAt: 900 - index, origin: 'user' })
    }
    provideSessions(ctx, headers)

    const options = await listSessionOptions(ctx, undefined)

    expect(options).toHaveLength(50)
    expect(options[0]?.id).toBe('session-00')
    expect(options.at(-1)?.id).toBe('session-49')
    expect(options.every(option => !option.current)).toBe(true)
    await ctx.fiber.dispose()
  })
})
