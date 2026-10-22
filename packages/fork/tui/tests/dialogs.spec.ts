import { describe, expect, it, vi } from 'vitest'
import { ChoiceDialog, dialogHeader, dialogHint, dialogWidths, renderFrame } from '../src/app/dialogs.ts'
import { themeFor } from '../src/app/theme.ts'

/** Dark theme shared by these tests. */
const THEME = themeFor('dark')

describe('dialog layout', () => {
  it('never narrows below the minimum panel width', () => {
    expect(dialogWidths(4)).toEqual({ total: 12, inner: 8 })
    expect(dialogWidths(40)).toEqual({ total: 40, inner: 36 })
    expect(renderFrame(['short'], 4, THEME)).toHaveLength(3)
  })

  it('pads every framed row to the panel width', () => {
    const lines = renderFrame(['alpha', 'a much longer line that is clipped'], 20, THEME)

    for (const line of lines) expect(line.replace(/\x1b\[[0-9;]*m/gu, '')).toHaveLength(20)
  })

  it('wraps supporting text under the title and skips an absent one', () => {
    const withDetail = dialogHeader('Approve bash?', 'The tool wants to write build output.', 30, THEME)
    expect(withDetail[0]).toContain('Approve bash?')
    expect(withDetail[1]).toBe('')
    expect(withDetail.slice(2).join(' ')).toContain('The tool wants')
    expect(withDetail.at(-1)).toBe('')

    expect(dialogHeader('Approve bash?', undefined, 30, THEME)).toEqual([expect.stringContaining('Approve bash?'), ''])
    expect(dialogHeader('Approve bash?', '   ', 30, THEME)).toEqual([expect.stringContaining('Approve bash?'), ''])
  })

  it('bounds the hint line', () => {
    expect(dialogHint('Enter select · Esc deny', 60, THEME)).toContain('Enter select')
  })
})

describe('ChoiceDialog', () => {
  /**
   * Build a dialog whose callbacks the test inspects.
   * @returns the dialog and its spies.
   */
  function dialog(): { dialog: ChoiceDialog; choose: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> } {
    const choose = vi.fn()
    const cancel = vi.fn()
    return {
      choose,
      cancel,
      dialog: new ChoiceDialog({
        title: 'Approve bash?',
        detail: 'The tool wants to write build output.',
        items: [
          { value: 'allowed-once', label: 'Allow once', description: 'run this one operation' },
          { value: 'rejected', label: 'Deny', description: 'refuse this operation' },
        ],
        hint: 'Enter select · Esc deny',
        onChoose: choose,
        onCancel: cancel,
      }, THEME),
    }
  }

  it('renders its title, rows, and hint inside the frame', () => {
    const { dialog: component } = dialog()
    const lines = component.render(60).join('\n')

    expect(lines).toContain('Approve bash?')
    expect(lines).toContain('Allow once')
    expect(lines).toContain('Deny')
    expect(lines).toContain('Enter select')
  })

  it('routes Enter to the highlighted row and Escape to the cancel path', () => {
    const accepted = dialog()
    accepted.dialog.handleInput('\r')
    expect(accepted.choose).toHaveBeenCalledWith('allowed-once')
    expect(accepted.cancel).not.toHaveBeenCalled()

    const declined = dialog()
    declined.dialog.handleInput('\x1b')
    expect(declined.cancel).toHaveBeenCalledTimes(1)
    expect(declined.choose).not.toHaveBeenCalled()
  })

  it('moves the highlight through the list', () => {
    const moved = dialog()
    moved.dialog.handleInput('\x1b[B')
    moved.dialog.handleInput('\r')
    expect(moved.choose).toHaveBeenCalledWith('rejected')
  })

  it('clears cached list state on invalidate', () => {
    const { dialog: component } = dialog()

    component.invalidate()

    expect(component.render(50).join('\n')).toContain('Allow once')
  })
})
