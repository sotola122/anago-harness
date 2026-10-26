/**
 * Source-launch lease holder for ownership.cross-process.spec.ts: acquires
 * one existing session directory's kernel write lock through the package
 * source, reports `holding`, waits for a `release` line on stdin, then
 * releases and reports `released`. Runs under `node --import tsx/esm` so the
 * probe is exercised against the code under test rather than built output.
 */

import { SessionId } from '@deepseek-ai/dsh-session'
import { SessionWriteLease } from '../../src/lease.ts'

const [dir, id] = process.argv.slice(2)
if (dir === undefined || id === undefined) {
  throw new Error('usage: lease-holder-source.ts <session-dir> <session-id>')
}
const lease = await SessionWriteLease.acquire(dir, SessionId(id))
process.stdout.write('holding\n')
await new Promise<void>((resolve) => {
  process.stdin.once('data', () => { resolve() })
})
await lease.release()
// Exit only after the final line is flushed: exiting with a pending pipe
// write can truncate it on Windows and hang the waiting parent.
process.stdout.write('released\n', () => { process.exit(0) })
