#!/usr/bin/env node
/**
 * Add the English command descriptions that the dsh-TUI 0.16.1 i18n
 * dictionary omits. In English mode those 60 `cmd-desc-*` keys fall back to
 * Chinese. The English text comes from the package's own command definitions
 * (`commands.js`); three keys without a definition are translated here.
 * Idempotent: re-run after every update of the package.
 *
 * Usage: node scripts/fork/patch-dsh-tui-i18n.mjs [package-dir]
 * Default: ~/.dsh/profiles/tui/node_modules/@deepseek-harness-tui/dsh-tui
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const pkgDir = resolve(process.argv[2] ?? join(homedir(), '.dsh/profiles/tui/node_modules/@deepseek-harness-tui/dsh-tui'))
const i18nPath = join(pkgDir, 'lib/types/i18n.js')
const commandsPath = join(pkgDir, 'lib/types/commands.js')

/** English for keys the command table does not describe. */
const EXTRA_EN = {
  'cmd-desc-plan': 'Toggle plan mode (/plan off to leave)',
  'cmd-desc-goal': 'Set or show the session goal',
  'cmd-desc-feedback': 'Send usage feedback',
}

const i18n = await import(pathToFileURL(i18nPath).href)
const commands = await import(pathToFileURL(commandsPath).href)
const descriptions = new Map()
for (const value of Object.values(commands)) {
  if (!Array.isArray(value)) continue
  for (const command of value) {
    if (command && typeof command === 'object' && typeof command.name === 'string' && typeof command.description === 'string') {
      descriptions.set(command.name, command.description)
    }
  }
}

const missing = []
for (const [key, entry] of Object.entries(i18n.i18nDict)) {
  if (!key.startsWith('cmd-desc-') || entry.en !== undefined) continue
  const name = key.slice('cmd-desc-'.length)
  const en = EXTRA_EN[key] ?? descriptions.get(name)
  if (typeof en !== 'string' || en.length === 0) {
    throw new Error(`no English description for ${key}; extend EXTRA_EN`)
  }
  missing.push([key, en])
}
if (missing.length === 0) {
  console.log('dsh-tui i18n: nothing to patch (already complete)')
  process.exit(0)
}

const quote = (text) => `'${text.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`
let source = readFileSync(i18nPath, 'utf8')
let patched = 0
for (const [key, en] of missing) {
  const pattern = new RegExp(`('${key}'\\s*:\\s*\\{\\s*zh:\\s*)('(?:[^'\\\\]|\\\\.)*')(\\s*\\})`)
  if (!pattern.test(source)) {
    throw new Error(`cannot locate the entry for ${key}; the package layout changed`)
  }
  source = source.replace(pattern, `$1$2, en: ${quote(en)}$3`)
  patched += 1
}
writeFileSync(i18nPath, source)

const patchedModule = await import(`${pathToFileURL(i18nPath).href}?v=${Date.now()}`)
const remaining = Object.entries(patchedModule.i18nDict)
  .filter(([key, entry]) => key.startsWith('cmd-desc-') && entry.en === undefined)
console.log(`dsh-tui i18n: patched ${patched} command descriptions in ${i18nPath}`)
if (remaining.length > 0) {
  console.error(`still missing English: ${remaining.map(([key]) => key).join(', ')}`)
  process.exit(1)
}
