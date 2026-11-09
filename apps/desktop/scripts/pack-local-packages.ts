/** Stage local-branded DSH packages for unsigned Desktop builds without a publication record. */

import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import {
  readClientBuildRecord,
  repositoryClientBuildEnvironment,
  resolveClientBuildEnvironment,
} from '../../../scripts/client-build-environment.ts'
import { pnpmInvocation } from '../../../scripts/pnpm-invocation.ts'
import { releaseFamily } from '../../../scripts/release/families.ts'
import { packFamilyMembers, parsePackConcurrency } from '../../../scripts/release/pack.ts'
import { runConcurrent } from '../../../scripts/release/process.ts'

/**
 * Fork packages the dsh closure requires but the release family never selects:
 * `plugins/*` joins the workspace outside `packages/` and `apps/`.
 */
const FORK_PLUGIN_WORKSPACE = './plugins/*'

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { out: { type: 'string' }, concurrency: { type: 'string' } },
    allowPositionals: false,
  })
  if (values.out === undefined) throw new Error('desktop local pack: --out must name the package staging directory')
  const concurrency = parsePackConcurrency(values.concurrency)
  const root = process.cwd()
  const environment = resolveClientBuildEnvironment(repositoryClientBuildEnvironment(root), 'local')
  readClientBuildRecord(root, environment)
  const destination = resolve(root, values.out)
  await packFamilyMembers(root, releaseFamily('dsh'), destination, concurrency)
  const plugins = pnpmInvocation([
    'pack',
    '--recursive',
    `--workspace-concurrency=${String(concurrency)}`,
    `--filter=${FORK_PLUGIN_WORKSPACE}`,
    '--pack-destination',
    destination,
  ])
  await runConcurrent(plugins.command, plugins.args)
  const tarballs = readdirSync(destination).filter(file => file.endsWith('.tgz')).length
  console.log(`desktop local pack: ${String(tarballs)} tarball(s) in ${destination}`)
}

await main()
