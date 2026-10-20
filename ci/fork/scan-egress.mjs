#!/usr/bin/env node
// Static gate for harness-builtin endpoints. Lists every (file, host) pair for http(s)/ws(s) URLs hardcoded in
// shipped source (tests, fixtures, snapshots and docs excluded) and diffs it against a reviewed baseline.
// A NEW pair fails the job. Pairs on the denylist are tagged DENIED. A *.deepseek.com host outside the
// removed-package directories and the two reviewed catalog files is tagged WATCH and fails even when baselined.
// usage: node ci/fork/scan-egress.mjs [repoRoot] [baseline.json] [--write-baseline]
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const positional = process.argv.slice(2).filter(arg => !arg.startsWith('--'))
const root = positional[0] ?? resolve(here, '../..')
const baselinePath = positional[1] ?? join(here, 'egress-baseline.json')
const write = process.argv.includes('--write-baseline')
const deny = JSON.parse(readFileSync(new URL('../../packages/fork/fork-policy/denylist.json', import.meta.url), 'utf8'))
const suffixes = Object.values(deny.suffixes).flat()
const hosts = new Set(deny.hosts)
const denied = host => hosts.has(host) || suffixes.some(suffix => host === suffix || host.endsWith('.' + suffix))
const watched = host => host === 'deepseek.com' || host.endsWith('.deepseek.com')
const REMOVED_DIRS = ['packages/llm/llm-deepseek/', 'packages/llm/llm-deepseek-api-key/', 'packages/llm/llm-deepseek-account/',
  'packages/llm/deepseek-llm-api-extensions/', 'packages/credentials/deepseek-account-platform/', 'packages/web/web-search-deepseek/',
  'packages/web/web-deepseek-api/', 'packages/client/ui-settings-web-search/', 'packages/client/ui-settings-account/',
  'packages/client/ui-deepseek-model-label-1017/', 'packages/test-support/', 'apps/desktop/scripts/', '.github/workflows/']
const WATCH_ALLOWED_FILES = new Set(['packages/llm/llm-pi-ai/src/provider-data.generated.ts',
  'packages/client/ui-settings-models/src/client/locales.ts'])
const watchViolation = (file, host) => watched(host) && !hosts.has(host) && !WATCH_ALLOWED_FILES.has(file) && !REMOVED_DIRS.some(dir => file.startsWith(dir))
const ignoredHost = host => /^(localhost|127\.|0\.0\.0\.0)|(^|\.)(example\.(com|org|net)|invalid|test|localhost)$/.test(host)
  || /^(www\.)?(w3\.org|json-schema\.org|schemas\.|github\.com|npmjs\.com|nodejs\.org)/.test(host)
const shipped = file => /\.(m?[jt]sx?|cts|mts|json|ya?ml|nsh|ps1|sh|html|css)$/.test(file)
  && !/(^|\/)(tests?|__tests__|fixtures|snapshots|benchmarks|docs|website)\//.test(file) && !/\.(spec|test|e2e|stress)\./.test(file)
  && !/(^|\/)(pnpm-lock\.yaml|package-lock\.json|uv\.lock|README[^/]*|[^/]*\.i18n\.yaml)$/.test(file)
const files = execFileSync('git', ['-C', root, 'ls-files'], { encoding: 'utf8', maxBuffer: 1 << 28 }).split('\n').filter(file => file && shipped(file))
const found = new Set()
const urlRe = /\b(?:https?|wss?):\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi
for (const file of files) {
  let text
  try {
    text = readFileSync(join(root, file), 'utf8')
  } catch (error) {
    // A raced deletion is absent from this scan; the next run reads the tree again.
    void error
    continue
  }
  for (const match of text.matchAll(urlRe)) {
    const host = match[1].toLowerCase()
    if (ignoredHost(host)) continue
    found.add(`${watchViolation(file, host) ? 'WATCH' : denied(host) ? 'DENIED' : 'other'}\t${file}\t${host}`)
  }
}
const current = [...found].sort()
if (write || !existsSync(baselinePath)) {
  writeFileSync(baselinePath, JSON.stringify(current, null, 1) + '\n')
  console.log(`baseline written: ${current.length} pairs`)
  process.exit(0)
}
const baseline = new Set(JSON.parse(readFileSync(baselinePath, 'utf8')))
const added = current.filter(key => !baseline.has(key))
const removed = [...baseline].filter(key => !found.has(key))
console.log(`pairs: ${current.length}, new: ${added.length}, gone: ${removed.length}`)
for (const key of added) console.log('NEW  ' + key)
const watch = current.filter(key => key.startsWith('WATCH'))
for (const key of watch) console.log('BUILTIN-DEEPSEEK  ' + key)
process.exit(added.length > 0 || watch.length > 0 ? 1 : 0)
