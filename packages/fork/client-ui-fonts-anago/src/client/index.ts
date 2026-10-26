/**
 * Japanese-first fonts for the Anago Web UI, browser half: the plugin mounts
 * one stylesheet that declares the woff2 faces and replaces the upstream font
 * tokens. UDEV Gothic draws kana, kanji, and full-width forms, Noto Sans JP is
 * the broad fallback, and Intel One Mono draws Latin and code; the stylesheet
 * also sets the text stack on the application root so existing components
 * inherit it without per-component declarations.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import stylesheet from '../styles/fonts.css?inline'
import { FONT_REPLACEMENTS } from './font-assets.ts'
import { installFontStyles, renderFontStylesheet } from './styles.ts'

/**
 * Mount the font stylesheet for the plugin lifetime.
 * @param ctx - The browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  installFontStyles(ctx, renderFontStylesheet(stylesheet, FONT_REPLACEMENTS))
}
