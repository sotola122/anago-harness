import { describe, expect, it, vi } from 'vitest'
import { PickerDialog } from '../src/app/picker-dialog.ts'
import { pickerStateOf, type PickerItem } from '../src/app/pickers.ts'
import { themeFor } from '../src/app/theme.ts'

/**
 * Remove terminal styling so assertions read the visible text.
 * @param text - rendered lines.
 * @returns the same text without SGR sequences.
 */
function plain(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/gu, '')
}

/** Dark theme shared by these tests. */
const THEME = themeFor('dark')

/** Rows used by the rendering tests. */
const ITEMS: readonly PickerItem[] = [
  { value: 'deepseek\u001fdeepseek-v4', label: 'DeepSeek V4', detail: 'flagship', group: 'deepseek' },
  { value: 'deepseek\u001fdeepseek-flash', label: 'DeepSeek Flash', group: 'deepseek' },
  { value: 'local\u001fqwen', label: 'Qwen', detail: 'local route', group: 'local' },
]

/**
 * Build a picker dialog over fixed rows.
 * @param items - selectable rows.
 * @param onChoose - selection callback override.
 * @param onCancel - cancellation callback override.
 * @returns the dialog and its spies.
 */
function dialog(
  items: readonly PickerItem[] = ITEMS,
  onChoose = vi.fn(),
  onCancel = vi.fn(),
): { dialog: PickerDialog; choose: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> } {
  return {
    choose: onChoose,
    cancel: onCancel,
    dialog: new PickerDialog({
      title: 'Model',
      detail: 'Registered provider routes from the Host LLM service.',
      hint: '↑↓ move · Enter select · Esc close · type to filter',
      state: pickerStateOf(items),
      onChoose,
      onCancel,
    }, THEME),
  }
}

describe('picker dialog input', () => {
  it('exposes and invalidates its state', () => {
    const { dialog: component } = dialog()

    expect(component.getState().query).toBe('')
    component.invalidate()
    expect(component.getState().items).toHaveLength(3)
  })

  it('cancels on Escape', () => {
    const { dialog: component, cancel, choose } = dialog()

    component.handleInput('\x1b')

    expect(cancel).toHaveBeenCalledTimes(1)
    expect(choose).not.toHaveBeenCalled()
  })

  it('moves the highlight with both arrows, wrapping at the ends', () => {
    const { dialog: component, choose } = dialog()

    component.handleInput('\x1b[A')
    expect(component.getState().index).toBe(2)

    component.handleInput('\x1b[B')
    expect(component.getState().index).toBe(0)

    component.handleInput('\x1b[B')
    component.handleInput('\r')
    expect(choose).toHaveBeenCalledWith(ITEMS[1])
  })

  it('selects only while the filter matches a row', () => {
    const matching = dialog()
    for (const character of 'qwen') matching.dialog.handleInput(character)
    matching.dialog.handleInput('\r')
    expect(matching.choose).toHaveBeenCalledWith(ITEMS[2])

    const missing = dialog()
    for (const character of 'zzz') missing.dialog.handleInput(character)
    missing.dialog.handleInput('\r')
    expect(missing.choose).not.toHaveBeenCalled()
  })

  it('edits the filter with printable characters and backspace', () => {
    const { dialog: component } = dialog()

    for (const character of 'flash') component.handleInput(character)
    expect(component.getState().query).toBe('flash')

    component.handleInput('\x7f')
    expect(component.getState().query).toBe('flas')

    for (let step = 0; step < 5; step += 1) component.handleInput('\x7f')
    expect(component.getState().query).toBe('')
    component.handleInput('\x7f')
    expect(component.getState().query).toBe('')
  })

  it('ignores pasted text and control keys it does not handle', () => {
    const { dialog: component } = dialog()

    component.handleInput('flash')
    component.handleInput('\x01')

    expect(component.getState().query).toBe('')
    expect(component.getState().index).toBe(0)
  })
})

describe('picker dialog rendering', () => {
  it('shows the filter placeholder and grouped rows', () => {
    const { dialog: component } = dialog()
    const frame = component.render(70).join('\n')

    expect(frame).toContain('Model')
    expect(frame).toContain('Registered provider routes')
    expect(frame).toContain('type to filter')
    expect(frame).toContain('deepseek')
    expect(frame).toContain('DeepSeek V4')
    expect(frame).toContain('flagship')
    expect(frame).toContain('local')
    expect(frame).not.toContain('(current)')
  })

  it('shows the typed filter and the no-match state', () => {
    const { dialog: component } = dialog()

    component.handleInput('q')
    expect(component.render(70).join('\n')).toContain('Qwen')
    expect(plain(component.render(70).join('\n'))).toContain('> q')

    for (const character of 'zzz') component.handleInput(character)
    expect(component.render(70).join('\n')).toContain('no matches')
  })

  it('scrolls a long list with leading and trailing overflow markers', () => {
    const many: PickerItem[] = Array.from({ length: 12 }, (_, index) => ({
      value: `value-${String(index)}`,
      label: `Row ${String(index)}`,
      group: index < 6 ? 'first' : 'second',
    }))
    const { dialog: component } = dialog(many)

    const firstFrame = component.render(70).join('\n')
    expect(firstFrame).toContain('… 4 more')
    expect(firstFrame).toContain('1/12')

    for (let step = 0; step < 9; step += 1) component.handleInput('\x1b[B')
    const scrolled = component.render(70).join('\n')
    expect(scrolled).toContain('… 4 more')
    expect(scrolled).toContain('10/12')
  })
})

/** Rows where one entry another process owns cannot be chosen. */
const DISABLED_ITEMS: readonly PickerItem[] = [
  { value: 'session-free', label: 'Free Session', detail: 'session-free', group: 'Today' },
  {
    value: 'session-held',
    label: 'Held Session',
    detail: 'session-held',
    group: 'Today',
    disabled: { reason: 'another process holds the write lease' },
  },
]

describe('picker dialog disabled rows', () => {
  it('dims the label and shows the reason in place of the detail', () => {
    const { dialog: component } = dialog(DISABLED_ITEMS)
    const lines = component.render(70)
    const held = lines.find(line => plain(line).includes('Held Session')) as string

    expect(held).toContain(THEME.dim('Held Session'))
    expect(plain(held)).toContain('another process holds the write lease')
    expect(plain(held)).not.toContain('session-held')

    const free = lines.find(line => plain(line).includes('Free Session')) as string
    expect(free).not.toContain(THEME.dim('Free Session'))
    expect(plain(free)).toContain('session-free')
  })

  it('refuses Enter with a notice and keeps the highlight', () => {
    const { dialog: component, choose } = dialog(DISABLED_ITEMS)

    component.handleInput('\x1b[B')
    component.handleInput('\r')

    expect(choose).not.toHaveBeenCalled()
    expect(component.getState().index).toBe(1)
    expect(plain(component.render(70).join('\n')))
      .toContain('cannot select: another process holds the write lease')

    component.handleInput('\x1b[A')
    expect(plain(component.render(70).join('\n'))).not.toContain('cannot select')
  })

  it('chooses an enabled row after a refusal', () => {
    const { dialog: component, choose } = dialog(DISABLED_ITEMS)

    component.handleInput('\x1b[B')
    component.handleInput('\r')
    component.handleInput('\x1b[A')
    component.handleInput('\r')

    expect(choose).toHaveBeenCalledWith(DISABLED_ITEMS[0])
  })
})
