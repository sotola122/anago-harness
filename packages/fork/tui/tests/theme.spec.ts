import { describe, expect, it } from 'vitest'
import { themeFor } from '../src/app/theme.ts'

describe('terminal themes', () => {
  it('resolves both palettes and defaults to dark', () => {
    expect(themeFor('dark').name).toBe('dark')
    expect(themeFor('light').name).toBe('light')
    expect(themeFor('dark').accent('x')).not.toBe(themeFor('light').accent('x'))
  })

  it('styles every markdown element through its palette', () => {
    const theme = themeFor('light')
    const markdown = theme.markdown

    expect(markdown.heading('Title')).toContain('Title')
    expect(markdown.link('docs')).toContain('docs')
    expect(markdown.code('inline')).toContain('inline')
    expect(markdown.codeBlock('block')).toContain('block')
    expect(markdown.codeBlockBorder('|')).toContain('|')
    expect(markdown.quote('quoted')).toContain('quoted')
    expect(markdown.quoteBorder('|')).toContain('|')
    expect(markdown.hr('---')).toContain('---')
    expect(markdown.listBullet('*')).toContain('*')
    expect(markdown.bold('b')).toContain('b')
    expect(markdown.italic('i')).toContain('i')
    expect(markdown.strikethrough('s')).toContain('s')
    expect(markdown.underline('u')).toContain('u')
    expect(markdown.linkUrl('https://example.test')).toContain('https://example.test')
  })

  it('exposes the select and editor themes derived from the palette', () => {
    const theme = themeFor('dark')

    expect(theme.select.selectedPrefix('>')).toContain('>')
    expect(theme.select.selectedText('row')).toContain('row')
    expect(theme.select.description('d')).toContain('d')
    expect(theme.select.scrollInfo('1/2')).toContain('1/2')
    expect(theme.select.noMatch('none')).toContain('none')
    expect(theme.editor.borderColor('│')).toContain('│')
    expect(theme.editor.selectList).toBe(theme.select)
  })
})
