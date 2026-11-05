/**
 * Japanese-first fonts for the Anago Web UI, browser half: the plugin mounts
 * one stylesheet that declares the woff2 faces and writes the configured lists
 * as the default stacks. UDEV Gothic draws kana, kanji, and full-width forms,
 * Noto Sans JP is the broad fallback, and Intel One Mono draws Latin and code;
 * the stylesheet also sets the text stack on the application root so existing
 * components inherit it without per-component declarations.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import stylesheet from '../styles/fonts.css?inline'
import { Config, FONT_CONFIG_GLOBAL } from '../config.ts'
import { FONT_REPLACEMENTS } from './font-assets.ts'
import { installFontStyles, renderFontStylesheet, renderFontTokenDefaults } from './styles.ts'

/**
 * Mount the font stylesheet for the plugin lifetime.
 * @param ctx - The browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  // The Host already validated these values; revalidating keeps a page without
  // the injection (a stale index) on the defaults instead of an empty stack.
  const configured = (globalThis as { [FONT_CONFIG_GLOBAL]?: unknown })[FONT_CONFIG_GLOBAL]
  const families = Config(configured ?? {})
  installFontStyles(ctx, renderFontStylesheet(stylesheet, FONT_REPLACEMENTS) + renderFontTokenDefaults(families))
}
