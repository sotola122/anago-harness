/**
 * Mount the font stylesheet for exactly the owning plugin lifetime.
 * The stylesheet ships with `__DSH_FONT_*__` placeholders because a CSS file
 * cannot import font bytes; {@link renderFontStylesheet} swaps each placeholder
 * for the data URL the client bundle carries.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Config } from '../config.ts'

/** Value of `data-plugin`, so the injected tag is attributable in the document. */
const PLUGIN_ID = '@anago-harness/client-ui-fonts-anago'

/** Interfaces whose configured lists become default tokens. */
const FONT_ROLES = ['text', 'code', 'terminal'] as const satisfies readonly (keyof Config)[]

/** Token each interface's configured list replaces. */
const FONT_FAMILY_DEFAULT_TOKENS = {
  text: '--dsh-font-family-text-default',
  code: '--dsh-font-family-code-default',
  terminal: '--dsh-font-family-terminal-default',
} as const satisfies Record<keyof Config, string>

/** One placeholder left in the rendered stylesheet; the font file it needs is missing. */
const UNRESOLVED_PLACEHOLDER = /__DSH_FONT_[A-Z0-9_]+__/u

/**
 * Replace every font placeholder with its data URL.
 * @param template - Stylesheet text carrying one placeholder per `@font-face`.
 * @param replacements - Placeholder → data URL map supplied by the build.
 * @returns the stylesheet with no placeholder left.
 * @throws {Error} when a placeholder has no replacement, or a replacement has
 * no placeholder in the stylesheet (either direction is a build wiring bug).
 */
export function renderFontStylesheet(
  template: string,
  replacements: Readonly<Record<string, string>>,
): string {
  let css = template
  for (const [placeholder, url] of Object.entries(replacements)) {
    if (!css.includes(placeholder)) {
      throw new Error(`client-ui-fonts-anago: the stylesheet has no ${placeholder} for ${Object.keys(replacements).length} font files`)
    }
    css = css.replaceAll(placeholder, url)
  }
  const unresolved = UNRESOLVED_PLACEHOLDER.exec(css)
  if (unresolved !== null) {
    throw new Error(`client-ui-fonts-anago: ${unresolved[0]} has no font file in FONT_REPLACEMENTS`)
  }
  return css
}

/**
 * Render the default-stack block appended to the stylesheet. The doubled
 * `:root` keeps ui-theme's specificity rule, so a user-selected list written on
 * body still leads; a list configured as `''` emits no declaration, leaving the
 * built-in stack in place.
 * @param families - Configured font lists by interface.
 * @returns The block, or `''` when every interface keeps the built-in stack.
 */
export function renderFontTokenDefaults(families: Config): string {
  const declarations = FONT_ROLES.flatMap((role) => {
    const list = families[role].trim()
    return list === '' ? [] : [`  ${FONT_FAMILY_DEFAULT_TOKENS[role]}: ${list};`]
  })
  return declarations.length === 0 ? '' : `\n:root:root {\n${declarations.join('\n')}\n}\n`
}

/**
 * Attach the rendered stylesheet to the document head while the plugin lives.
 * @param ctx - Owning plugin context; disposal removes the tag.
 * @param css - Rendered stylesheet text.
 */
export function installFontStyles(ctx: Context, css: string): void {
  if (typeof document === 'undefined') return
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = PLUGIN_ID
    tag.dataset.pluginCss = `${PLUGIN_ID}/fonts.css`
    tag.textContent = css
    document.head.appendChild(tag)
    return () => { tag.remove() }
  }, 'client-ui-fonts-anago: font faces and font-family tokens')
}
