import { describe, expect, it } from 'vitest'
import {
  applySlashCompletion,
  commandByName,
  filterSlashCommands,
  helpText,
  parseSlashInput,
  SLASH_COMMANDS,
  SlashCommandProvider,
  slashCompletion,
} from '../src/app/commands.ts'

describe('slash command parsing', () => {
  it('parses a command and its arguments', () => {
    expect(parseSlashInput('/model')).toEqual({ name: 'model', args: '' })
    expect(parseSlashInput('/resume session-1')).toEqual({ name: 'resume', args: 'session-1' })
    expect(parseSlashInput('  /help  extra ')).toEqual({ name: 'help', args: 'extra' })
  })

  it('leaves ordinary prompts and malformed commands alone', () => {
    expect(parseSlashInput('please run /help')).toBeUndefined()
    expect(parseSlashInput('/Help')).toBeUndefined()
    expect(parseSlashInput('/')).toBeUndefined()
    expect(parseSlashInput('/helpme')).toEqual({ name: 'helpme', args: '' })
  })

  it('resolves known names only', () => {
    expect(commandByName('quit')?.name).toBe('quit')
    expect(commandByName('theme')).toBeUndefined()
    expect(SLASH_COMMANDS.map(command => command.name)).toEqual(['help', 'model', 'clear', 'resume', 'quit'])
  })
})

describe('slash command completion', () => {
  it('lists every command for a bare slash', () => {
    expect(slashCompletion(['/'], 0, 1)?.items).toHaveLength(SLASH_COMMANDS.length)
  })

  it('filters by the typed prefix, ignoring case', () => {
    const completion = slashCompletion(['/HE'], 0, 3)
    expect(completion?.prefix).toBe('/HE')
    expect(completion?.items.map(item => item.value)).toEqual(['help'])
    expect(filterSlashCommands('re').map(command => command.name)).toEqual(['resume'])
  })

  it('supports a command typed after indentation', () => {
    expect(slashCompletion(['   /mo'], 0, 6)?.prefix).toBe('/mo')
  })

  it('stops suggesting once the token has arguments or leaves the first line', () => {
    expect(slashCompletion(['/help now'], 0, 9)).toBeNull()
    expect(slashCompletion(['first', '/he'], 1, 3)).toBeNull()
    expect(slashCompletion(['/zzz'], 0, 4)).toBeNull()
  })

  it('replaces the typed token and leaves the rest of the line intact', () => {
    expect(applySlashCompletion(['/he'], 0, 3, { value: 'help', label: 'help' }, '/he'))
      .toEqual({ lines: ['/help '], cursorLine: 0, cursorCol: 6 })
    expect(applySlashCompletion(['  /mo'], 0, 5, { value: 'model', label: 'model' }, '/mo'))
      .toEqual({ lines: ['  /model '], cursorLine: 0, cursorCol: 9 })
  })

  it('exposes the same behavior through the autocomplete provider', async () => {
    const provider = new SlashCommandProvider()
    await expect(provider.getSuggestions(['/qu'], 0, 3)).resolves.toEqual({
      items: [{ value: 'quit', label: 'quit', description: 'exit the terminal UI' }],
      prefix: '/qu',
    })
    await expect(provider.getSuggestions(['hello'], 0, 5)).resolves.toBeNull()
    expect(provider.applyCompletion(['/qu'], 0, 3, { value: 'quit', label: 'quit' }, '/qu'))
      .toEqual({ lines: ['/quit '], cursorLine: 0, cursorCol: 6 })
  })

  it('documents every command and the expand key in help text', () => {
    const text = helpText()
    for (const command of SLASH_COMMANDS) expect(text).toContain(command.usage)
    expect(text).toContain('Ctrl+O')
  })
})

describe('completion edge cases', () => {
  it('ignores an empty editor and a cursor outside the buffer', () => {
    expect(slashCompletion([], 0, 0)).toBeNull()
    expect(applySlashCompletion([], 0, 0, { value: 'help', label: 'help' }, '/he'))
      .toEqual({ lines: ['/help '], cursorLine: 0, cursorCol: 6 })
  })
})
