/**
 * Japanese language pack, browser half: adds `ja` to the locale selector and
 * registers the namespaces translated here. Lookup misses walk the locale
 * service's per-key fallback chain to English, so a namespace this pack omits
 * keeps the shipped English copy.
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { commonJa } from './common.ts'
import { pluginInventoryJa, pluginManagerJa } from './plugins.ts'
import { localeJa, settingsJa, shellJa } from './settings.ts'
import { webSearchProvidersJa } from './web-search.ts'

/** Cordis plugin name. */
export const name = 'client-locale-ja'

/** The locale service this pack registers into. */
export const inject = ['locale']

/** Selectable language this pack adds; English terminates its fallback chain. */
const LANGUAGE = { id: 'ja', label: '日本語', fallback: 'en' } as const

/** Translated namespaces, registered in display-independent order. */
const DICTIONARIES: ReadonlyArray<readonly [string, Record<string, string>]> = [
  ['common', commonJa],
  ['settings', settingsJa],
  ['settings.locale', localeJa],
  ['settings.shell', shellJa],
  ['settings.pluginInventory', pluginInventoryJa],
  ['pluginManager', pluginManagerJa],
  ['settings.webSearchProviders', webSearchProvidersJa],
]

/**
 * Register the language definition and each dictionary as owned effects, so
 * unloading the plugin removes them from the selector and from lookup.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.addLanguage(LANGUAGE), 'client-locale-ja: language')
  for (const [ns, dictionary] of DICTIONARIES) {
    ctx.effect(() => ctx.locale.register(ns, LANGUAGE.id, dictionary), `client-locale-ja: ${ns} dictionary`)
  }
}
