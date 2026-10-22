/**
 * The stylesheet builder and the tag it mounts: every placeholder becomes the
 * bundled data URL, a mismatched build fails loud in either direction, and the
 * document holds the tag for exactly the plugin lifetime.
 */

import { readFileSync } from 'node:fs'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FONT_REPLACEMENTS } from '../src/client/font-assets.ts'
import { installFontStyles, renderFontStylesheet } from '../src/client/styles.ts'
import { apply as applyHost } from '../src/index.ts'

// Vitest serves CSS imports as empty strings; the bundle build hands the entry
// the shipped stylesheet, so the bench supplies that same text.
vi.mock('../src/styles/fonts.css?inline', async () => ({
  default: (await import('node:fs')).readFileSync(new URL('../src/styles/fonts.css', import.meta.url), 'utf8'),
}))

const { apply: applyClient } = await import('../src/client/index.ts')

/** A style tag as the stub document records it. */
interface StubTag {
  readonly dataset: Record<string, string>
  textContent: string
  removed: boolean
  remove(): void
}

/** The global document the module reads, restored after each test. */
const realDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')

afterEach(() => {
  if (realDocument === undefined) Reflect.deleteProperty(globalThis, 'document')
  else Object.defineProperty(globalThis, 'document', realDocument)
})

/**
 * Install a stub document holding the tags its head receives.
 * @returns the tags appended to the stub head, in append order.
 */
function installDocument(): StubTag[] {
  const tags: StubTag[] = []
  const document = {
    createElement(): StubTag {
      const tag: StubTag = {
        dataset: {},
        textContent: '',
        removed: false,
        remove() {
          tag.removed = true
          const index = tags.indexOf(tag)
          if (index >= 0) tags.splice(index, 1)
        },
      }
      return tag
    },
    head: {
      appendChild(tag: StubTag) {
        tags.push(tag)
      },
    },
  }
  Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: document })
  return tags
}

describe('renderFontStylesheet', () => {
  it('replaces every placeholder with its data URL', () => {
    const template = 'a __DSH_FONT_ANAGO_GOTHIC__ b __DSH_FONT_NOTO_SANS_JP_LATIN__ c'
    const css = renderFontStylesheet(template, {
      __DSH_FONT_ANAGO_GOTHIC__: 'data:font/woff2;base64,AAA',
      __DSH_FONT_NOTO_SANS_JP_LATIN__: 'data:font/woff2;base64,BBB',
    })
    expect(css).toBe('a data:font/woff2;base64,AAA b data:font/woff2;base64,BBB c')
    expect(css).not.toMatch(/__DSH_FONT_/u)
  })

  it('ships a replacement for every placeholder the stylesheet carries', () => {
    const stylesheet = readFileSync(new URL('../src/styles/fonts.css', import.meta.url), 'utf8')
    const css = renderFontStylesheet(stylesheet, FONT_REPLACEMENTS)
    expect(css).not.toMatch(/url\(__DSH_FONT_/u)
    expect(css).toContain(`url(${FONT_REPLACEMENTS.__DSH_FONT_ANAGO_GOTHIC__})`)
  })

  it('rejects a font file the stylesheet does not use', () => {
    expect(() => renderFontStylesheet('no placeholders', { __DSH_FONT_ANAGO_GOTHIC__: 'data:' }))
      .toThrow(/the stylesheet has no __DSH_FONT_ANAGO_GOTHIC__ for 1 font files/u)
  })

  it('rejects a placeholder the replacement map does not cover', () => {
    expect(() => renderFontStylesheet('__DSH_FONT_NOTO_SANS_JP_KANA__', {}))
      .toThrow(/__DSH_FONT_NOTO_SANS_JP_KANA__ has no font file in FONT_REPLACEMENTS/u)
  })
})

describe('installFontStyles', () => {
  it('does nothing outside a browser document', async () => {
    Reflect.deleteProperty(globalThis, 'document')
    const ctx = new Context()
    expect(() => installFontStyles(ctx, 'body {}')).not.toThrow()
    await ctx.fiber.dispose()
  })

  it('mounts an attributable tag and removes it with the plugin', async () => {
    const tags = installDocument()
    const ctx = new Context()
    installFontStyles(ctx, 'body { font-family: Anago Gothic; }')

    expect(tags).toHaveLength(1)
    const tag = tags[0] as StubTag
    expect(tag.dataset).toEqual({
      plugin: '@anago-harness/client-ui-fonts-anago',
      pluginCss: '@anago-harness/client-ui-fonts-anago/fonts.css',
    })
    expect(tag.textContent).toBe('body { font-family: Anago Gothic; }')

    await ctx.fiber.dispose()
    expect(tags).toHaveLength(0)
    expect(tag.removed).toBe(true)
  })
})

describe('plugin entries', () => {
  it('keeps the host row inert', () => {
    expect(applyHost()).toBeUndefined()
  })

  it('mounts the rendered shipped stylesheet from the browser entry', async () => {
    const tags = installDocument()
    const ctx = new Context()
    applyClient(ctx)

    expect(tags).toHaveLength(1)
    const css = tags[0]?.textContent ?? ''
    expect(css).not.toMatch(/url\(__DSH_FONT_/u)
    expect(css).toContain('@font-face')
    expect(css).toContain("font-family: 'Anago Gothic';")

    await ctx.fiber.dispose()
    expect(tags).toHaveLength(0)
  })
})
