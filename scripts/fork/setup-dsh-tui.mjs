#!/usr/bin/env node
/**
 * Prepare an installed dsh-TUI for the anago deployment:
 *   1. skip the first-run wizard (no DeepSeek key),
 *   2. pin the UI and working-activity language to English (the OS locale is
 *      Japanese, which falls through to Chinese),
 *   3. add the missing English command descriptions.
 * Idempotent; safe to run after every dsh-TUI update.
 *
 * Usage: node scripts/fork/setup-dsh-tui.mjs [package-dir]
 * Default package dir: ~/.dsh/profiles/tui/node_modules/@deepseek-harness-tui/dsh-tui
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const pkgDir = resolve(process.argv[2] ?? join(homedir(), '.dsh/profiles/tui/node_modules/@deepseek-harness-tui/dsh-tui'))
if (!existsSync(pkgDir)) {
  console.error(`setup-dsh-tui: no dsh-TUI package at ${pkgDir}`)
  process.exit(1)
}

const dataDir = join(homedir(), '.dsh-tui')
mkdirSync(dataDir, { recursive: true })

const writeIfAbsent = (name, value) => {
  const path = join(dataDir, name)
  if (existsSync(path)) {
    console.log(`setup-dsh-tui: ${path} already exists`)
    return
  }
  writeFileSync(path, `${JSON.stringify(value)}\n`)
  console.log(`setup-dsh-tui: wrote ${path}`)
}

writeIfAbsent('lang.json', { lang: 'en' })
writeIfAbsent('onboarding.json', { completed: true, version: 1 })

const patcher = join(dirname(fileURLToPath(import.meta.url)), 'patch-dsh-tui-i18n.mjs')
const result = spawnSync(process.execPath, [patcher, pkgDir], { stdio: 'inherit' })
process.exit(result.status ?? 1)
