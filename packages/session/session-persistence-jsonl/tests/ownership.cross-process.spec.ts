/**
 * Real cross-process ownership: a child Node process loads the lease module
 * from source under tsx, takes one session directory's kernel write lock, and
 * keeps it until this process asks for release. While it lives, the probe
 * must answer `held-elsewhere`; after it releases, `free`. Both handshakes
 * are promise-coordinated over the child's stdout and stdin, so no test sleeps
 * and no polling window can race the lock state. Keyless.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface, type Interface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SESSION_FORMAT_VERSION, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import * as JsonlSessionPersistence from '../src/index.ts'
import { sessionDir } from '../src/format.ts'

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const HOLDER = fileURLToPath(new URL('./fixtures/lease-holder-source.ts', import.meta.url))

const dirs: string[] = []
const contexts: Context[] = []
const holders: ChildProcess[] = []

afterEach(async () => {
  for (const holder of holders.splice(0)) {
    if (holder.exitCode === null) holder.kill('SIGKILL')
  }
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

function meta(id: string): SessionHeader {
  return { version: SESSION_FORMAT_VERSION, id: SessionId(id), createdAt: 1_000, cwd: '/work', isSeeded: false }
}

async function mount(root: string): Promise<SessionPersistence> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  return ctx.sessionPersistence
}

/**
 * Wait for the child's next stdout line, failing fast with its captured
 * stderr when it exits first instead.
 * @param lines - the child's stdout line reader.
 * @param exited - resolves with the child's exit code; registered when it spawned.
 * @param diagnostics - returns the child's captured stderr.
 * @returns the next complete stdout line.
 */
async function nextLine(
  lines: Interface,
  exited: Promise<number | null>,
  diagnostics: () => string,
): Promise<string> {
  const read = new Promise<{ readonly kind: 'line'; readonly value: string }>((resolve) => {
    lines.once('line', (value) => { resolve({ kind: 'line', value }) })
  })
  const outcome = await Promise.race([
    read,
    exited.then(code => ({ kind: 'exit' as const, code })),
  ])
  if (outcome.kind === 'exit') {
    throw new Error(`lease holder exited with code ${String(outcome.code)} before signaling: ${diagnostics()}`)
  }
  return outcome.value
}

describe('cross-process session ownership', () => {
  it('reports held-elsewhere while a source-launched child holds the lock', { timeout: 30_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-ownership-2proc-'))
    dirs.push(root)
    const backend = await mount(root)
    const id = SessionId('cross-process')
    const writer = await backend.create(meta('cross-process'))
    await writer.append([
      { type: 'turn/start', seq: SessionSeq(0), time: 1, data: { turn: 1 } },
      { type: 'turn/end', seq: SessionSeq(1), time: 2, data: { turn: 1, reason: { kind: 'completed' } } },
    ])
    await writer.close()

    const child = spawn(
      process.execPath,
      ['--import', 'tsx/esm', HOLDER, sessionDir(root, '/work', id), id],
      { cwd: REPO_ROOT, stdio: ['pipe', 'pipe', 'pipe'] },
    )
    holders.push(child)
    // Register the exit observer before the child can exit, so no await can
    // miss the event.
    const exited = new Promise<number | null>((resolve) => {
      child.once('exit', (code) => { resolve(code) })
    })
    if (child.stdout === null || child.stdin === null) throw new Error('lease holder spawned without pipes')
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    const lines = createInterface({ input: child.stdout })
    try {
      // 'holding' means the child's kernel lock is already taken.
      expect(await nextLine(lines, exited, () => stderr)).toBe('holding')
      await expect(backend.ownership(id)).resolves.toBe('held-elsewhere')

      child.stdin.write('release\n')
      expect(await nextLine(lines, exited, () => stderr)).toBe('released')
      await exited
      await expect(backend.ownership(id)).resolves.toBe('free')
    } finally {
      lines.close()
    }
  })
})
