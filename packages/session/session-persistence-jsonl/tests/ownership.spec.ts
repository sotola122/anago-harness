/**
 * Session write-ownership classification through the JSONL backend: the
 * in-process claim, absent storage, an idle materialized session, a foreign
 * holder, and an undecidable probe. Every case also pins that the probe
 * itself creates nothing: no session directory, no lock file. A real
 * cross-process holder is pinned by ownership.cross-process.spec.ts; the
 * permission refusal is injected because POSIX modes cannot express it
 * deterministically on Windows hosts.
 */

import { existsSync } from 'node:fs'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SESSION_FORMAT_VERSION, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import * as JsonlSessionPersistence from '../src/index.ts'
import { LEASE_FILENAME } from '../src/lease.ts'
import { sessionDir } from '../src/format.ts'

// The lock's base name, duplicated for the hoisted mock factory: it runs
// while `../src/lease.ts` is still evaluating, before LEASE_FILENAME exists.
const LOCK = vi.hoisted(() => 'session.lock')

const refuse = vi.hoisted(() => ({
  /** Next open of a lock file fails EACCES (an unreadable lock file). */
  lockOpen: false,
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    open: (async (path: unknown, ...rest: never[]) => {
      if (refuse.lockOpen && String(path).endsWith(LOCK)) {
        refuse.lockOpen = false
        throw Object.assign(new Error('EACCES: injected open refusal'), { code: 'EACCES' })
      }
      return (actual.open as (path: unknown, ...args: never[]) => Promise<unknown>)(path, ...rest)
    }) as typeof actual.open,
  }
})

const dirs: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  refuse.lockOpen = false
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

function meta(id: string): SessionHeader {
  return { version: SESSION_FORMAT_VERSION, id: SessionId(id), createdAt: 1_000, cwd: '/work', isSeeded: false }
}

async function freshRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-jsonl-ownership-'))
  dirs.push(root)
  return root
}

async function mount(root: string): Promise<SessionPersistence> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  return ctx.sessionPersistence
}

function dirOf(root: string, id: string): string {
  return sessionDir(root, '/work', SessionId(id))
}

function lockPath(root: string, id: string): string {
  return join(dirOf(root, id), LEASE_FILENAME)
}

const EVENTS = [
  { type: 'turn/start', seq: SessionSeq(0), time: 1, data: { turn: 1 } },
  { type: 'turn/end', seq: SessionSeq(1), time: 2, data: { turn: 1, reason: { kind: 'completed' } } },
] as const

describe('session ownership', () => {
  it('reports a materialized session as free once its writer closed', async () => {
    const root = await freshRoot()
    const backend = await mount(root)
    const writer = await backend.create(meta('idle'))
    await writer.append([...EVENTS])
    await writer.close()

    await expect(backend.ownership(SessionId('idle'))).resolves.toBe('free')
  })

  it('reports an absent id as missing without creating the root', async () => {
    const root = join(await freshRoot(), 'never-created')
    const backend = await mount(root)

    await expect(backend.ownership(SessionId('absent'))).resolves.toBe('missing')
    expect(existsSync(root)).toBe(false)
  })

  it('reports a created session as owned here before it materializes, and missing after it closes unmaterialized', async () => {
    const root = await freshRoot()
    const backend = await mount(root)
    const handle = await backend.create(meta('pending'))

    await expect(backend.ownership(SessionId('pending'))).resolves.toBe('owned-here')
    expect(existsSync(dirOf(root, 'pending'))).toBe(false)
    await handle.close()
    await expect(backend.ownership(SessionId('pending'))).resolves.toBe('missing')
    expect(existsSync(dirOf(root, 'pending'))).toBe(false)
  })

  it('reports a write-open handle as owned here while it holds the session', async () => {
    const root = await freshRoot()
    const backend = await mount(root)
    const writer = await backend.create(meta('write-open'))
    await writer.append([...EVENTS])
    await writer.close()

    const reopened = await backend.open(SessionId('write-open'), 'write')
    await expect(backend.ownership(SessionId('write-open'))).resolves.toBe('owned-here')
    await reopened.close()
    await expect(backend.ownership(SessionId('write-open'))).resolves.toBe('free')
  })

  it('reports held-elsewhere while another backend instance holds the write lock', async () => {
    const root = await freshRoot()
    const first = await mount(root)
    const second = await mount(root)
    const holder = await first.create(meta('foreign'))
    await holder.append([...EVENTS])

    await expect(second.ownership(SessionId('foreign'))).resolves.toBe('held-elsewhere')
    await holder.close()
    // Release drops the kernel lock; the POSIX lock file itself survives.
    await expect(second.ownership(SessionId('foreign'))).resolves.toBe('free')
  })

  it('creates no lock file while probing a materialized session', async () => {
    const root = await freshRoot()
    const backend = await mount(root)
    const writer = await backend.create(meta('no-lock-residue'))
    await writer.append([...EVENTS])
    await writer.close()
    const dir = dirOf(root, 'no-lock-residue')
    // POSIX keeps the lock file created by the write path; removing it leaves
    // a stored session whose probe must answer from absence, not recreate it.
    if (process.platform !== 'win32') await rm(lockPath(root, 'no-lock-residue'))
    const before = await readdir(dir)

    await expect(backend.ownership(SessionId('no-lock-residue'))).resolves.toBe('free')

    expect(existsSync(lockPath(root, 'no-lock-residue'))).toBe(false)
    expect(await readdir(dir)).toEqual(before)
  })

  it.skipIf(process.platform === 'win32')('reports unknown when the lock file cannot be opened', async () => {
    const root = await freshRoot()
    const backend = await mount(root)
    const writer = await backend.create(meta('undecidable'))
    await writer.append([...EVENTS])
    await writer.close()

    refuse.lockOpen = true
    await expect(backend.ownership(SessionId('undecidable'))).resolves.toBe('unknown')
  })

  it('rejects a cancelled probe instead of classifying it as unknown', async () => {
    const root = await freshRoot()
    const backend = await mount(root)
    const controller = new AbortController()
    controller.abort()

    await expect(backend.ownership(SessionId('cancelled'), { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' })
  })
})
