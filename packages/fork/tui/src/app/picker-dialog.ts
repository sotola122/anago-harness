/**
 * Filterable picker overlay used by the model and Session selectors.
 * @module @anago-harness/tui/app/picker-dialog
 */

import {
  matchesKey,
  truncateToWidth,
  type Component,
} from '../term/pi-tui.ts'
import {
  pickerAppend,
  pickerBackspace,
  pickerMove,
  pickerSelection,
  visiblePickerItems,
  type PickerItem,
  type PickerState,
} from './pickers.ts'
import { dialogHeader, dialogHint, dialogWidths, renderFrame } from './dialogs.ts'
import type { Theme } from './theme.ts'

/** Rows visible before the list starts scrolling. */
const MAX_VISIBLE_ROWS = 8

/** One picker dialog definition. */
export interface PickerDialogOptions {
  /** Bold dialog title. */
  readonly title: string
  /** Optional supporting text. */
  readonly detail?: string
  /** Operation hint under the list. */
  readonly hint: string
  /** Initial picker state. */
  readonly state: PickerState
  /** Called with the selected row. */
  readonly onChoose: (item: PickerItem) => void
  /** Called on Escape. */
  readonly onCancel: () => void
}

/**
 * Render one row, marking the highlighted entry.
 *
 * A disabled row keeps its position and highlight but dims the label and shows
 * its refusal reason in the detail column, so the reason is readable without
 * choosing the row.
 * @param item - row to render.
 * @param selected - whether the row is highlighted.
 * @param width - available columns.
 * @param theme - active theme.
 * @returns one bounded line.
 */
function renderRow(item: PickerItem, selected: boolean, width: number, theme: Theme): string {
  const marker = selected ? theme.accent('❯ ') : '  '
  if (item.disabled !== undefined) {
    const label = theme.dim(item.label)
    const reason = theme.dim(` · ${item.disabled.reason}`)
    return truncateToWidth(`${marker}${label}${reason}`, width)
  }
  const label = selected ? theme.accent(item.label) : item.label
  const detail = item.detail === undefined ? '' : theme.dim(` · ${item.detail}`)
  return truncateToWidth(`${marker}${label}${detail}`, width)
}

/** A selectable, filterable list inside a bordered panel. */
export class PickerDialog implements Component {
  private readonly options: PickerDialogOptions
  private readonly theme: Theme
  private state: PickerState
  private refusal: string | undefined

  /**
   * @param options - dialog content and callbacks.
   * @param theme - active theme.
   */
  constructor(options: PickerDialogOptions, theme: Theme) {
    this.options = options
    this.theme = theme
    this.state = options.state
  }

  /**
   * Current picker state, for tests.
   * @returns the filter text and highlight.
   */
  getState(): PickerState {
    return this.state
  }

  /** Clear cached render state. */
  invalidate(): void {}

  /**
   * Route keys: arrows move, Enter selects, Escape cancels, and printable text
   * filters the list.
   *
   * Enter on a disabled row keeps the dialog open, replaces the callback with
   * a refusal notice, and leaves the highlight in place; any later key clears
   * the notice.
   * @param data - raw terminal input.
   */
  handleInput(data: string): void {
    this.refusal = undefined
    if (matchesKey(data, 'escape')) {
      this.options.onCancel()
      return
    }
    if (matchesKey(data, 'up')) {
      this.state = pickerMove(this.state, -1)
      return
    }
    if (matchesKey(data, 'down')) {
      this.state = pickerMove(this.state, 1)
      return
    }
    if (matchesKey(data, 'return')) {
      const selection = pickerSelection(this.state)
      if (selection === undefined) return
      if (selection.disabled !== undefined) {
        this.refusal = `cannot select: ${selection.disabled.reason}`
        return
      }
      this.options.onChoose(selection)
      return
    }
    if (matchesKey(data, 'backspace')) {
      this.state = pickerBackspace(this.state)
      return
    }
    if (isPrintable(data)) {
      this.state = pickerAppend(this.state, data)
    }
  }

  /**
   * Render the dialog, including a refusal notice after a disabled row was
   * chosen.
   * @param width - overlay width.
   * @returns panel lines, each at most `width` columns.
   */
  render(width: number): string[] {
    const { total, inner } = dialogWidths(width)
    const content = dialogHeader(this.options.title, this.options.detail, inner, this.theme)
    const placeholder = this.theme.dim('type to filter')
    content.push(`${this.theme.accent('> ')}${this.state.query === '' ? placeholder : this.state.query}`)
    content.push('')
    const visible = visiblePickerItems(this.state)
    if (visible.length === 0) {
      content.push(this.theme.dim('no matches'))
    } else {
      const index = Math.min(Math.max(this.state.index, 0), visible.length - 1)
      const start = Math.max(0, Math.min(index - Math.floor(MAX_VISIBLE_ROWS / 2), visible.length - MAX_VISIBLE_ROWS))
      const end = Math.min(visible.length, start + MAX_VISIBLE_ROWS)
      if (start > 0) content.push(this.theme.dim(`  … ${String(start)} more`))
      let group: string | undefined
      for (let position = start; position < end; position += 1) {
        const item = visible[position] as PickerItem
        if (item.group !== undefined && item.group !== group) {
          group = item.group
          content.push(this.theme.dim(item.group))
        }
        content.push(renderRow(item, position === index, inner, this.theme))
      }
      if (end < visible.length) content.push(this.theme.dim(`  … ${String(visible.length - end)} more`))
      if (visible.length > MAX_VISIBLE_ROWS) {
        content.push(this.theme.dim(`${String(index + 1)}/${String(visible.length)}`))
      }
    }
    if (this.refusal !== undefined) {
      content.push('')
      content.push(this.theme.error(this.refusal))
    }
    content.push('')
    content.push(dialogHint(this.options.hint, inner, this.theme))
    return renderFrame(content, total, this.theme)
  }
}

/**
 * Whether one input chunk is a single printable character.
 * @param data - raw terminal input.
 * @returns true when the editor should append it to the filter.
 */
function isPrintable(data: string): boolean {
  if (data.length !== 1) return false
  const code = data.charCodeAt(0)
  return code >= 32 && code !== 127
}
