/** Validate the assembled application, including native Office conversion outside ASAR. */
import { X509Certificate } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { desktopArtifactOutput, resolveDesktopBuildTarget, resolveDesktopTargetBuildPaths } from './desktop-build-paths.mjs'
import { readDesktopRuntime, verifyDesktopRuntime } from '../src/runtime-tree.ts'
import { verifyWindowsCode, verifyWindowsSelfSignedCode } from './windows-runtime-signature.mjs'
import { smokePreparedRuntime } from './smoke-prepared-runtime.ts'
import { authenticodeArchiveExclusions, type ArchiveHashExclusion } from './verify-runtime-archive.ts'
import { resolveDesktopPackageTarget } from './package-target.ts'

const paths = resolveDesktopTargetBuildPaths()
const { values } = parseArgs({ options: { unsigned: { type: 'boolean', default: false }, 'self-sign': { type: 'boolean', default: false }, 'skip-notarization': { type: 'boolean', default: false } }, allowPositionals: false })
const target = resolveDesktopBuildTarget()
const windows = target === 'win-x64'
const linux = target === 'linux-x64'
const artifacts = desktopArtifactOutput(paths, {
  unsigned: values.unsigned, selfSign: values['self-sign'], skipNotarization: values['skip-notarization'],
}).directory
const application = windows ? join(artifacts, 'win-unpacked')
  : linux ? join(artifacts, 'linux-unpacked')
    : join(artifacts, target === 'mac-arm64' ? 'mac-arm64' : 'mac', 'DeepSeek Harness.app', 'Contents')
const resources = join(application, windows || linux ? 'resources' : 'Resources')
const executable = windows ? join(application, 'DeepSeek Harness.exe')
  : linux ? join(application, 'deepseek-harness')
    : join(application, 'MacOS', 'DeepSeek Harness')
const descriptor = await verifyDesktopRuntime(paths.dsh, readDesktopRuntime(paths.dsh).release.version,
  resolveDesktopPackageTarget(target))
if (windows && !values.unsigned) {
  if (values['self-sign']) {
    const { ANAGO_SIGNING_CERTIFICATE } = await import('./windows-self-sign.mjs')
    const thumbprint = new X509Certificate(await readFile(ANAGO_SIGNING_CERTIFICATE)).fingerprint.replaceAll(':', '')
    await verifyWindowsSelfSignedCode(application, { thumbprint })
  }
  else await verifyWindowsCode(application)
}
// Unsigned and eToken routes compare every hash. Self-sign skips only files the hook recorded as rewritten.
const hashExclusions: ArchiveHashExclusion[] = []
if (values['self-sign']) {
  const runDirectory = process.env.DSH_DESKTOP_PACKAGING_RUN_DIR
  if (runDirectory === undefined || runDirectory === '') {
    throw new Error('desktop runtime: self-sign archive check requires DSH_DESKTOP_PACKAGING_RUN_DIR')
  }
  const events = await readFile(join(runDirectory, 'events.jsonl'), 'utf8').catch((error: unknown) => {
    const code = typeof error === 'object' && error !== null && 'code' in error
      && (typeof error.code === 'string' || typeof error.code === 'number') ? String(error.code) : 'error'
    throw new Error(`desktop runtime: self-sign rewrite record is unreadable: ${runDirectory} (${code})`, { cause: error })
  })
  const recorded = authenticodeArchiveExclusions(events, join(resources, 'app.asar.unpacked', 'dsh'))
  hashExclusions.push(...recorded.exclusions)
  process.stdout.write(`desktop runtime: self-sign archive check excludes ${hashExclusions.length} authenticode-appended file(s) from ${recorded.rewriteRecords} rewrite record(s)\n`)
}
await smokePreparedRuntime(join(resources, 'app.asar', 'dsh'), executable, join(resources, 'runtime'), descriptor, hashExclusions)
