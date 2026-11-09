import { join } from 'node:path'
import { expect, it } from 'vitest'
import { authenticodeArchiveExclusions } from '../scripts/verify-runtime-archive.ts'

const unpacked = join('/package', 'resources', 'app.asar.unpacked', 'dsh')

function line(event: object): string {
  return JSON.stringify(event)
}

it('maps only recorded authenticode rewrites under the unpacked dsh tree', () => {
  const events = [
    line({ type: 'stage-start', stage: 'artifacts' }),
    line({ type: 'windows-self-sign-rewritten', path: join(unpacked, 'node_modules', 'foo', 'native.node'), reason: 'authenticode-appended' }),
    line({ type: 'windows-self-sign-rewritten', path: join('/package', 'DeepSeek Harness.exe'), reason: 'authenticode-appended' }),
    line({ type: 'windows-self-sign-rewritten', path: join('/package', 'resources', 'runtime', 'python.exe'), reason: 'authenticode-appended' }),
    line({ type: 'windows-code-signature-verified', path: join(unpacked, 'other.node'), reason: 'authenticode-appended' }),
  ].join('\n')
  expect(authenticodeArchiveExclusions(events, unpacked)).toEqual({
    exclusions: [{ path: 'node_modules/foo/native.node', reason: 'authenticode-appended' }],
    rewriteRecords: 3,
  })
})

it('rejects a rewrite record that does not name the authenticode reason', () => {
  const events = line({ type: 'windows-self-sign-rewritten', path: join(unpacked, 'native.node'), reason: 'other' })
  expect(() => authenticodeArchiveExclusions(events, unpacked)).toThrow('invalid self-sign rewrite record')
  expect(() => authenticodeArchiveExclusions('{', unpacked)).toThrow('invalid self-sign rewrite record')
})
