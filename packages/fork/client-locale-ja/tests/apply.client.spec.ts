/** What the pack registers, the copy it serves, the English fallback it leaves, and that all of it unloads. */

import { readFileSync } from 'node:fs'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { agentPresetJa } from '../src/client/agent-preset.ts'
import { approvalJa } from '../src/client/approval.ts'
import { chatJa } from '../src/client/chat.ts'
import { conversationJa } from '../src/client/conversation.ts'
import { apply, inject, name } from '../src/client/index.ts'
import { layoutJa } from '../src/client/layout.ts'
import { questionJa } from '../src/client/question.ts'
import { sidebarJa } from '../src/client/sidebar.ts'
import { workspaceJa } from '../src/client/workspace.ts'
import { apply as applyHost } from '../src/index.ts'

/**
 * The exact key sets of the English dictionaries these namespaces mirror,
 * recorded from the owning client packages. A key added, renamed, or dropped
 * there must be carried over here in the same change; the parity test below
 * reports which key diverged instead of leaving English-only copy in the UI.
 */
const ENGLISH_KEYS = JSON.parse(
  readFileSync(new URL('./fixtures/english-keys.json', import.meta.url), 'utf8'),
) as Record<string, readonly string[]>

/** Translated dictionaries compared against their English source key sets. */
const MIRRORED: ReadonlyArray<readonly [string, Record<string, string>]> = [
  ['conversation', conversationJa],
  ['chat', chatJa],
  ['approval', approvalJa],
  ['question', questionJa],
  ['settings.agentPreset', agentPresetJa],
  ['workspace', workspaceJa],
  ['sidebar', sidebarJa],
  ['shortcuts.layout', layoutJa],
]

/**
 * A browser context carrying the locale service plus the English keys the
 * fallback assertions read. The shipped English dictionaries belong to the
 * feature packages that compose this one, so the bench supplies only the two
 * strings the assertions compare against.
 */
function bench(): { ctx: Context; locale: LocaleRuntime } {
  const ctx = new Context()
  const locale = new LocaleRuntime(ctx)
  locale.register('common', 'en', { cancel: 'Cancel' })
  locale.register('pluginManager', 'en', { installGuideIdExample: 'dsh-plugin-whale-pet' })
  ctx.provide('locale', locale)
  return { ctx, locale }
}

/** Activate the pack through a fiber, as the client module system would. */
async function activate(ctx: Context) {
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return fiber
}

describe('client-locale-ja', () => {
  it('adds the ja language and makes it selectable', async () => {
    const { ctx, locale } = bench()
    await activate(ctx)

    expect(locale.getLocale().locales).toContainEqual({ id: 'ja', label: '日本語', fallback: 'en' })
    locale.setLocale('ja')
    expect(locale.getLocale().active).toBe('ja')
  })

  it('serves translated copy from each registered namespace', async () => {
    const { ctx, locale } = bench()
    await activate(ctx)
    locale.setLocale('ja')

    expect(locale.bind('common')('cancel')).toBe('キャンセル')
    expect(locale.bind('settings')('title')).toBe('設定')
    expect(locale.bind('settings.locale')('language.title')).toBe('言語')
    expect(locale.bind('settings.shell')('title')).toBe('シェル')
    expect(locale.bind('settings.pluginInventory')('tab')).toBe('プラグイン一覧')
    expect(locale.bind('pluginManager')('addPlugin')).toBe('プラグインを追加')
    expect(locale.bind('settings.webSearchProviders')('titleExa')).toBe('Exa 検索')
    expect(locale.bind('workspace')('workspace.add')).toBe('ワークスペースを追加')
    expect(locale.bind('sidebar')('toggle.collapse')).toBe('サイドバーを折りたたむ')
    expect(locale.bind('shortcuts.layout')('toggle')).toBe('左サイドバーを開閉')
    expect(locale.bind('chat')('message.turnProcess.worked')).toBe('完了')
    expect(locale.bind('approval')('waiting')).toBe('承認待ち')
    expect(locale.bind('question')('plan.approve')).toBe('承認')
  })

  it('renders the hero and the agent-preset modes in Japanese', async () => {
    const { ctx, locale } = bench()
    await activate(ctx)
    locale.setLocale('ja')

    expect(locale.bind('conversation')('hero.headline')).toBe('未知の世界へ')
    expect(locale.bind('conversation')('hero.preview')).toBe('プレビュー')
    expect(locale.bind('conversation')('hero.chooseWorkspace')).toBe('ワークスペースを選択')
    expect(locale.bind('conversation')('placeholder.workspace')).toBe('ワークスペースを選択して開始')
    expect(locale.bind('settings.agentPreset')('presetStandardName')).toBe('標準モード')
    expect(locale.bind('settings.agentPreset')('presetCordisName')).toBe('クリエイターモード')
    expect(locale.bind('settings.agentPreset')('presetStandardDescription')).toContain('ほとんどのタスク')
  })

  it('mirrors every English key of the namespaces it translates', () => {
    for (const [ns, dictionary] of MIRRORED) {
      const expected = ENGLISH_KEYS[ns]
      if (expected === undefined) throw new Error(`no recorded English key set for ${ns}`)
      expect(Object.keys(dictionary).sort(), `${ns} key set diverges from English`).toEqual([...expected].sort())
    }
  })

  it('falls back to English for a key the pack deliberately leaves out', async () => {
    const { ctx, locale } = bench()
    await activate(ctx)
    locale.setLocale('ja')

    // A package name reads the same in both languages, so this key is absent
    // from the ja dictionary and must resolve through the English fallback.
    expect(locale.bind('pluginManager')('installGuideIdExample')).toBe('dsh-plugin-whale-pet')
    expect(locale.bind('pluginManager')('addPlugin')).toBe('プラグインを追加')
  })

  it('removes the language and every dictionary when the plugin unloads', async () => {
    const { ctx, locale } = bench()
    const fiber = await activate(ctx)
    locale.setLocale('ja')

    await fiber.dispose()

    expect(locale.getLocale().locales.map(entry => entry.id)).not.toContain('ja')
    expect(locale.getLocale().active).toBe('en')
    expect(locale.bind('common')('cancel')).toBe('Cancel')
  })

  it('declares its Cordis name and the locale service it waits for', () => {
    expect(name).toBe('client-locale-ja')
    expect(inject).toEqual(['locale'])
  })

  it('keeps the host Loader row inert', () => {
    expect(() => { applyHost() }).not.toThrow()
  })
})
