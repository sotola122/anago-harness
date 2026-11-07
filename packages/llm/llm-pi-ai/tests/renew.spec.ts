/**
 * A flow's renewal over pi-ai's real auth resolution and the real credential
 * store; only the issuer's token endpoint is faked.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import type { CredentialRecord } from '@deepseek-ai/dsh-credentials'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import { authContextFrom, credentialStoreFrom, recordKeyFor } from '../src/auth.ts'
import { registerPiAiFlows } from '../src/login.ts'

const XAI = recordKeyFor('xai')
const TOKEN_URL = 'https://auth.x.ai/oauth2/token'
const HOUR = 3_600_000
const dirs: string[] = []
const roots: Context[] = []

/** A context with the real store and seam, holding one stored xAI grant. */
async function harness(record: CredentialRecord): Promise<Context> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pi-renew-'))
  dirs.push(dir)
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
  await ctx.plugin(AuthorizationService)
  registerPiAiFlows(ctx, { credentials: credentialStoreFrom(ctx), authContext: authContextFrom(ctx) })
  await ctx.credentials.modifyRecord(XAI, () => Promise.resolve(record))
  return ctx
}

const grant = (expires: number): CredentialRecord => ({
  kind: 'grant', payload: { type: 'oauth', access: 'old-access', refresh: 'old-refresh', expires },
})

/** Replace `fetch` with a stand-in for the issuer, recording what it was sent. */
function fakeIssuer(respond: () => Response) {
  const calls: { url: string; refreshToken: string | null }[] = []
  vi.stubGlobal('fetch', (input: string | URL, init?: RequestInit) => {
    calls.push({ url: String(input), refreshToken: new URLSearchParams(init?.body as URLSearchParams).get('refresh_token') })
    return Promise.resolve(respond())
  })
  return calls
}

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('pi-ai flow renewal', () => {
  it('refreshes an expired grant and stores the rotated tokens under the same record', async () => {
    const ctx = await harness(grant(Date.now() - HOUR))
    const calls = fakeIssuer(() => Response.json({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 }))

    await expect(ctx.authorization.renew(XAI, new AbortController().signal)).resolves.toBe('current')

    expect(calls).toEqual([{ url: TOKEN_URL, refreshToken: 'old-refresh' }])
    await expect(ctx.credentials.readRecord(XAI)).resolves.toMatchObject({
      kind: 'grant', payload: { access: 'new-access', refresh: 'new-refresh' },
    })
  })

  it('leaves a grant that is not due untouched and contacts nobody', async () => {
    const stored = grant(Date.now() + HOUR)
    const ctx = await harness(stored)
    const calls = fakeIssuer(() => Response.json({}))

    await expect(ctx.authorization.renew(XAI, new AbortController().signal)).resolves.toBe('current')

    expect(calls).toEqual([])
    await expect(ctx.credentials.readRecord(XAI)).resolves.toEqual(stored)
  })

  it('rejects when the issuer refuses and keeps the stored grant for a retry', async () => {
    const stored = grant(Date.now() - HOUR)
    const ctx = await harness(stored)
    fakeIssuer(() => Response.json({ error: 'invalid_grant' }, { status: 400 }))

    await expect(ctx.authorization.renew(XAI, new AbortController().signal)).rejects.toThrow('OAuth refresh failed for xai')

    await expect(ctx.credentials.readRecord(XAI)).resolves.toEqual(stored)
  })

  it('refreshes once for concurrent renewals of one record', async () => {
    const ctx = await harness(grant(Date.now() - HOUR))
    const calls = fakeIssuer(() => Response.json({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 }))
    const { signal } = new AbortController()

    await Promise.all([ctx.authorization.renew(XAI, signal), ctx.authorization.renew(XAI, signal)])

    expect(calls).toHaveLength(1)
  })
})
