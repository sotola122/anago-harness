/**
 * The ownership probe Remote: the Web and the terminal ask which process
 * holds a Session's writer lease before presenting it. The probe is advisory,
 * so these tests cover classification, de-duplication, the batch bound, and
 * the session-resource filter — never write exclusion.
 */

import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHeader, SessionOwnership } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { createSessionTestController, testSessionPersistence } from './test-remote.ts'

const sid = (value: string): SessionId => value as SessionId

const DEFAULTS = {
  defaultModelSelection: () => ({ provider: 'p', model: 'm' }),
  cwd: '/tmp',
}

/**
 * Compose a controller over one stored Session header and a probe double.
 * @param ownership - per-id ownership answer.
 * @returns the composed context and controller.
 */
async function fixture(ownership: (id: SessionId) => Promise<SessionOwnership>) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  const header: SessionHeader = {
    version: SESSION_FORMAT_VERSION,
    id: sid('stored'),
    createdAt: 1,
    cwd: '/tmp',
    isSeeded: false,
  }
  ctx.provide('sessionPersistence', testSessionPersistence(ctx, {
    list: () => Promise.resolve([header]),
    ownership,
  }) as never)
  return { ctx, controller: await createSessionTestController(ctx, DEFAULTS) }
}

describe('sessions.ownership', () => {
  it('classifies each requested Session once', async () => {
    const { ctx, controller } = await fixture(async id =>
      (String(id) === 'held' ? 'held-elsewhere' : 'free'))
    try {
      await expect(controller.ownership([sid('a'), sid('a'), sid('held')]))
        .resolves.toEqual({ a: 'free', held: 'held-elsewhere' })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('passes unknown through rather than guessing free', async () => {
    const { ctx, controller } = await fixture(async () => 'unknown')
    try {
      await expect(controller.ownership([sid('a')])).resolves.toEqual({ a: 'unknown' })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('rejects a batch above the probe limit', async () => {
    const { ctx, controller } = await fixture(async () => 'free')
    try {
      const ids = Array.from({ length: 201 }, (_, index) => sid(`session-${String(index)}`))
      await expect(controller.ownership(ids)).rejects.toMatchObject({ code: 'gateway/bad-request' })
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
