/** What the pack registers, the copy it serves, the English fallback it leaves, and that all of it unloads. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject, name } from '../src/client/index.ts'
import { apply as applyHost } from '../src/index.ts'

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
    expect(applyHost()).toBeUndefined()
  })
})
