/**
 * Cross-process write-ownership lock for one session's artifact directory,
 * held for the whole life of a write handle. The arbiter is the kernel:
 * POSIX takes a non-blocking `flock(2)` via native system support on `session.lock`
 * beside the log, and Windows holds a named kernel semaphore derived from
 * that path — never a file lock or handle, so readers, searches, and
 * directory removal proceed freely while the lock is held. Contention maps
 * to `SessionAlreadyOwnedError`; the kernel releases the lock when the
 * holder's descriptor or last object handle closes, including on any process
 * death, so a crashed holder never blocks a successor. A live but wedged
 * holder keeps the lock until its process exits: there is deliberately no
 * expiry that could expropriate a stalled writer whose resumed appends would
 * tear the log.
 * A POSIX lock names an inode, not a path, so after locking the holder
 * verifies the locked inode is still the file at the lock path and retries
 * otherwise: an unlinked-and-recreated lock file carries a fresh inode, and
 * a lock on the orphaned one proves nothing. Removing a live session's lock
 * file therefore forfeits exclusion on POSIX (nothing in the harness does
 * so); Windows has no lock file at all. Readers never touch the lock.
 * The lock is acquired at write-open of an existing artifact and, for a
 * created session, only right before its first materializing write — an
 * unmaterialized session has no filesystem footprint. Release never removes
 * the POSIX lock file: every acquired lock belongs to a materialized or
 * materializing session, and the surviving file keeps the stable inode later
 * lockers verify against. The browser worker stubs the native flock entry to
 * immediate success: it is single-process, so the in-process write claim
 * already excludes every writer.
 * {@link probeLease} answers whether any writer holds the lock for a
 * diagnostic without creating the directory or the lock file; it classifies
 * one moment and never takes durable ownership.
 * @module @deepseek-ai/dsh-session-persistence-jsonl/lease
 */

import { mkdir, open, stat } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { join } from 'node:path'
import { tryLockExclusive } from '@deepseek-ai/node-addon-system/flock'
import { SessionAlreadyOwnedError } from '@deepseek-ai/dsh-session-persistence'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { acquireLockHandleWin32, releaseLockHandleWin32 } from './win32.ts'

/** Base name of the kernel lock file inside a session's directory. */
export const LEASE_FILENAME = 'session.lock'

/** The held kernel lock: a POSIX descriptor or a Win32 semaphore handle. */
type HeldLock =
  | { readonly kind: 'posix'; readonly handle: FileHandle }
  | { readonly kind: 'win32'; readonly handle: number }

/**
 * One platform lock attempt: the held lock, contention with another holder,
 * or — on POSIX when a writer asked to create the lock — an inode that no
 * longer matches the lock path and must be retried.
 */
type LockAttempt =
  | { readonly result: 'held'; readonly held: HeldLock }
  | { readonly result: 'contended' }
  | { readonly result: 'churned' }

/** Whether a flock failure means another descriptor holds the lock. */
function isLockContention(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code
  // flock(2) reports EAGAIN; some libcs spell it EWOULDBLOCK.
  return code === 'EAGAIN' || code === 'EWOULDBLOCK'
}

/** Whether a filesystem error means absence; every non-ENOENT failure must surface. */
function isENOENT(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

/**
 * Take the kernel lock at one lock path.
 *
 * Writer mode opens the file (creating it if absent) and verifies that the
 * locked POSIX inode is still the file at the lock path, so an unlinked and
 * recreated lock file forces a retry. Diagnostic mode opens only an existing
 * file and skips that verification: it holds the lock for one closed
 * question, so the locked path is authoritative.
 * @param path - the lock file path, also the Win32 semaphore name source.
 * @param create - whether a writer owns the lock file's creation and inode.
 * @returns the writer-mode attempt; `churned` only when `create` is true.
 */
async function tryPlatformLock(path: string, create: true): Promise<LockAttempt>
/** Diagnostic platform lock attempt on an existing file: the held lock or another holder. */
async function tryPlatformLock(path: string, create: false): Promise<HeldLock | 'contended'>
async function tryPlatformLock(path: string, create: boolean): Promise<LockAttempt | HeldLock | 'contended'> {
  /* v8 ignore start -- native Windows coverage exercises this platform branch; Linux covers the POSIX peer */
  if (process.platform === 'win32') {
    let handle: number
    try {
      handle = await acquireLockHandleWin32(path)
    } catch (error: unknown) {
      // Sharing violation: another handle already holds the write exclusion.
      if ((error as NodeJS.ErrnoException | null)?.code === 'EBUSY') {
        return create ? { result: 'contended' } : 'contended'
      }
      throw error
    }
    return create ? { result: 'held', held: { kind: 'win32', handle } } : { kind: 'win32', handle }
  }
  /* v8 ignore stop */
  const handle = await open(path, create ? 'w' : 'r')
  try {
    try {
      await tryLockExclusive(handle.fd)
    } catch (error: unknown) {
      if (!isLockContention(error)) throw error
      await handle.close()
      return create ? { result: 'contended' } : 'contended'
    }
    if (!create) return { kind: 'posix', handle }
    const held = await handle.stat({ bigint: true })
    const current = await stat(path, { bigint: true }).catch((error: unknown) => {
      if (isENOENT(error)) return undefined
      throw error
    })
    if (current !== undefined && current.ino === held.ino && current.dev === held.dev) {
      return { result: 'held', held: { kind: 'posix', handle } }
    }
    // The locked inode is no longer the file at the lock path: the caller
    // retries against whatever now stands there.
    await handle.close()
    return { result: 'churned' }
  } catch (error: unknown) {
    await handle.close()
    throw error
  }
}

/**
 * Release a held kernel lock by closing its descriptor or object handle. The
 * POSIX lock file is never removed: every acquired lock belongs to a
 * materialized or materializing session, and keeping the file preserves the
 * stable inode later lockers verify against.
 * @param held - the lock to release.
 */
async function releaseHeldLock(held: HeldLock): Promise<void> {
  /* v8 ignore start -- native Windows coverage exercises this platform branch; Linux covers the POSIX peer */
  if (held.kind === 'win32') {
    await releaseLockHandleWin32(held.handle)
    return
  }
  /* v8 ignore stop */
  await held.handle.close()
}

/** Whether one session directory's kernel write lock is held: `held` while a writer holds it, `free` otherwise. */
export type LeaseProbe = 'free' | 'held'

/**
 * Classify whether a writer currently holds one session directory's kernel
 * lock, without creating the directory or the lock file and without leaving
 * the lock taken.
 *
 * On POSIX the write path creates `session.lock` before locking it, so an
 * absent file means no writer holds this directory's lease. Windows locks a
 * named kernel semaphore with no filesystem footprint, so its probe always
 * asks the kernel. The answer describes one moment: another process may take
 * or release the lock immediately afterwards.
 * @param dir - the session's artifact directory, which already holds a selected generation.
 * @returns `held` while any writer holds the lock, `free` otherwise.
 */
export async function probeLease(dir: string): Promise<LeaseProbe> {
  const path = join(dir, LEASE_FILENAME)
  let outcome: HeldLock | 'contended'
  try {
    outcome = await tryPlatformLock(path, false)
  } catch (error: unknown) {
    // POSIX: the write path creates the lock file before locking it, so its
    // absence proves that no writer holds this directory's lease.
    if (isENOENT(error)) return 'free'
    throw error
  }
  if (outcome === 'contended') return 'held'
  await releaseHeldLock(outcome)
  return 'free'
}

/**
 * One held write lock. Constructed only by {@link SessionWriteLease.acquire};
 * `release` closes the descriptor or handle, which is what releases the lock.
 */
export class SessionWriteLease {
  private released = false

  private constructor(private readonly held: HeldLock) {}

  /**
   * Acquire the session directory's kernel write lock.
   * @param dir - the session's artifact directory (created if absent).
   * @param id - the session the lock guards, for error identities.
   * @returns the held lock.
   * @throws {SessionAlreadyOwnedError} while another holder keeps the lock.
   */
  static async acquire(dir: string, id: SessionId): Promise<SessionWriteLease> {
    const path = join(dir, LEASE_FILENAME)
    // Owner-only like materializePosix's directories: the lock may create the
    // session directory first, and both creators must agree on the mode.
    await mkdir(dir, { recursive: true, mode: 0o700 })
    /* v8 ignore start -- native Windows coverage exercises this platform branch; Linux covers the POSIX peer */
    if (process.platform === 'win32') {
      const attempt = await tryPlatformLock(path, true)
      if (attempt.result !== 'held') throw new SessionAlreadyOwnedError(id)
      return new SessionWriteLease(attempt.held)
    }
    /* v8 ignore stop */
    // Bounded retry: locking an inode a releasing creator just unlinked (or a
    // recreated path) re-opens the fresh file; steady state needs one pass.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const locked = await tryPlatformLock(path, true)
      if (locked.result === 'contended') throw new SessionAlreadyOwnedError(id)
      if (locked.result === 'churned') continue
      return new SessionWriteLease(locked.held)
    }
    throw new SessionAlreadyOwnedError(id)
  }

  /**
   * Release the kernel lock by closing its descriptor or handle. The POSIX
   * lock file is never removed: every acquired lock belongs to a
   * materialized or materializing session, and keeping the file preserves
   * the stable inode later lockers verify against. Idempotent.
   */
  async release(): Promise<void> {
    if (this.released) return
    this.released = true
    await releaseHeldLock(this.held)
  }
}
