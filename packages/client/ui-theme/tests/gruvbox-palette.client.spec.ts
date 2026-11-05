/**
 * Gruvbox palette contract, asserted against the CSS text on disk: the
 * `gruvbox` sheet declares every custom property the dark blocks of the token
 * sheets declare, so a named palette cannot leave a token on the default dark
 * palette (or the light one) and the palette is complete by construction.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseRules } from './stylesheet-scan.ts'

const DARK_MARKER = 'data-ds-dark-theme'
const GRUVBOX_MARKER = "data-ds-theme-palette='gruvbox'"

const readSheet = (name: string): string => readFileSync(
  fileURLToPath(new URL(`../src/styles/${name}`, import.meta.url)), 'utf8')

/**
 * Custom properties declared by the rules whose selectors carry one marker.
 * @param css - stylesheet text.
 * @param marker - attribute substring that scopes the palette.
 * @returns the declared custom-property names.
 */
function declaredTokens(css: string, marker: string): Set<string> {
  return new Set(parseRules(css)
    .filter(rule => rule.selectors.some(selector => selector.includes(marker)))
    .flatMap(rule => rule.declarations.map(([property]) => property))
    .filter(property => property.startsWith('--')))
}

/** The sheets whose dark blocks define the built-in dark palette. */
const DARK_SHEETS = ['design-platform.css', 'shiki.css', 'onboarding.css', 'gradient-shadow-text.css'] as const

const gruvboxDeclarations = new Map(parseRules(readSheet('gruvbox.css'))
  .filter(rule => rule.selectors.some(selector => selector.includes(GRUVBOX_MARKER)))
  .flatMap(rule => rule.declarations))

describe('gruvbox palette', () => {
  it('defines every token the dark palette defines', () => {
    const dark = new Set(DARK_SHEETS.flatMap(name => [...declaredTokens(readSheet(name), DARK_MARKER)]))
    const missing = [...dark].filter(token => !gruvboxDeclarations.has(token)).sort()
    expect(missing).toEqual([])
  })

  it('uses the Gruvbox background, foreground, accents, and neutrals', () => {
    expect(gruvboxDeclarations.get('--dsw-alias-bg-base')).toBe('#282828')
    expect(gruvboxDeclarations.get('--dsw-alias-label-primary')).toBe('#ebdbb2')
    const values = [...gruvboxDeclarations.values()].join(' ')
    for (const color of [
      '#fb4934', '#b8bb26', '#fabd2f', '#83a598', '#d3869b', '#8ec07c', '#fe8019',
      '#3c3836', '#504945', '#665c54', '#928374', '#a89984',
    ]) {
      expect(values, color).toContain(color)
    }
  })

  it('keeps the default-blue focus and link accents out of the palette', () => {
    // The shared focus ring falls back to state-business-primary; links use --dsw-alias-link.
    expect(gruvboxDeclarations.get('--dsw-alias-state-business-primary')).toBe('#83a598')
    expect(gruvboxDeclarations.get('--dsw-alias-link')).toBe('#83a598')
    expect(gruvboxDeclarations.get('--dsw-alias-state-warn-primary')).toBe('#fabd2f')
    expect(gruvboxDeclarations.get('--dsw-alias-state-error-primary')).toBe('#fb4934')
  })
})
