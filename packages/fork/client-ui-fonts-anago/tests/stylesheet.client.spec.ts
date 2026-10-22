/** The shipped stylesheet names the Japanese-first families, keeps Latin out of the UDEV range, and ships one OFL text per font. */

import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const packageDir = resolve(import.meta.dirname, '..')

/** Stylesheet text, read as shipped so the assertions cover the delivered CSS. */
const stylesheet = readFileSync(resolve(packageDir, 'src/styles/fonts.css'), 'utf8')

/** One `@font-face` block, from its opening brace to the closing brace. */
function fontFaces(): string[] {
  return stylesheet.split('@font-face {').slice(1).map(block => block.slice(0, block.indexOf('}')))
}

/** CSS text of one `font-family` declaration's block, keyed by family name. */
function faceOf(family: string): string[] {
  return fontFaces().filter(block => block.includes(`font-family: '${family}'`))
}

/** Upstream stacks that the fork override has to keep as its tail. */
const UPSTREAM_TEXT_STACK = "-apple-system, BlinkMacSystemFont,\n    'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif"
const UPSTREAM_CODE_STACK = "'SF Mono',\n    'JetBrains Mono', 'Fira Code', Consolas, 'Liberation Mono', Menlo, Courier, 'PingFang SC', 'Microsoft YaHei'"

describe('Japanese font stylesheet', () => {
  it('declares the three families with a blocking-free swap policy', () => {
    const faces = fontFaces()
    expect(faces).toHaveLength(7)
    for (const face of faces) {
      expect(face).toContain('font-display: swap;')
      expect(face).toContain('font-style: normal;')
      expect(face).toMatch(/src: url\(__DSH_FONT_[A-Z0-9_]+__\) format\('woff2'\);/u)
      expect(face).toContain('unicode-range: ')
    }
    expect(faceOf('UDEV Gothic')).toHaveLength(1)
    expect(faceOf('Noto Sans JP')).toHaveLength(3)
    expect(faceOf('Intel One Mono')).toHaveLength(3)
  })

  it('keeps Latin out of the Japanese text face so it falls through', () => {
    const [gothic] = faceOf('UDEV Gothic')
    expect(gothic).toBeDefined()
    const range = /unicode-range: ([^;]+);/u.exec(gothic ?? '')?.[1] ?? ''
    expect(range).toContain('U+3040-309F')
    expect(range).toContain('U+4E00-9FFF')
    expect(range).toContain('U+FF01-FF60')
    expect(range).not.toContain('U+0000')
    expect(range).not.toContain('U+0041')
  })

  it('replaces the token defaults ahead of the upstream stacks', () => {
    expect(stylesheet).toContain(':root:root {')
    const textDefault = /--dsh-font-family-text-default: ([^;]+);/u.exec(stylesheet)?.[1] ?? ''
    expect(textDefault).toBe("'UDEV Gothic', 'Noto Sans JP', " + UPSTREAM_TEXT_STACK)
    const codeDefault = /--dsh-font-family-code-default: ([^;]+);/u.exec(stylesheet)?.[1] ?? ''
    expect(codeDefault).toBe("'Intel One Mono', 'UDEV Gothic', 'Noto Sans JP', " + UPSTREAM_CODE_STACK)
    // Japanese inside a code span must resolve to the shipped faces, never to the
    // upstream Chinese-first entries that follow them.
    const codeFamilies = codeDefault.split(',').map(family => family.trim())
    expect(codeFamilies.indexOf("'UDEV Gothic'")).toBeLessThan(codeFamilies.indexOf("'PingFang SC'"))
    expect(codeFamilies.indexOf("'Noto Sans JP'")).toBeLessThan(codeFamilies.indexOf("'Microsoft YaHei'"))
  })

  it('puts the text stack on the application root so components inherit it', () => {
    expect(stylesheet).toMatch(/body,\n#root \{\n  font-family: var\(--dsw-font-family\);\n\}/u)
  })

  it('carries one placeholder per shipped font file and no literal URL', () => {
    const placeholders = [...stylesheet.matchAll(/__DSH_FONT_[A-Z0-9_]+__/gu)].map(match => match[0])
    expect(placeholders).toHaveLength(7)
    expect(new Set(placeholders).size).toBe(7)
    expect(stylesheet).not.toMatch(/url\((?!__DSH_FONT_)/u)
    expect(stylesheet).not.toMatch(/https?:/u)
  })

  it('ships the SIL OFL text for every font family', () => {
    const licenses = readdirSync(resolve(packageDir, 'src/fonts')).filter(name => name.endsWith('-OFL.txt')).sort()
    expect(licenses).toEqual(['Intel-One-Mono-OFL.txt', 'Noto-Sans-JP-OFL.txt', 'UDEV-Gothic-OFL.txt'])
    for (const license of licenses) {
      const text = readFileSync(resolve(packageDir, 'src/fonts', license), 'utf8')
      expect(text).toContain('SIL OPEN FONT LICENSE Version 1.1')
    }
    expect(readFileSync(resolve(packageDir, 'src/fonts/UDEV-Gothic-OFL.txt'), 'utf8')).toContain('Copyright (c) 2022 Yuko OTAWARA.')
    expect(readFileSync(resolve(packageDir, 'src/fonts/Noto-Sans-JP-OFL.txt'), 'utf8')).toContain('Google Inc.')
    expect(readFileSync(resolve(packageDir, 'src/fonts/Intel-One-Mono-OFL.txt'), 'utf8')).toContain('The Intel One Mono Project Authors')
  })
})
