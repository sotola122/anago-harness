/**
 * Modal choice dialogs shared by approval and user-question handling.
 * @module @anago-harness/tui/app/dialogs
 */

import {
  SelectList,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
  type SelectItem,
} from '../term/pi-tui.ts'
import type { Theme } from './theme.ts'

/** One dialog definition. */
export interface ChoiceDialogOptions {
  /** Bold dialog title. */
  readonly title: string
  /** Optional supporting text, wrapped under the title. */
  readonly detail: string | undefined
  /** Rows offered to the human. */
  readonly items: readonly SelectItem[]
  /** Operation hint under the list. */
  readonly hint: string
  /** Called with the selected value. */
  readonly onChoose: (value: string) => void
  /** Called on Escape. */
  readonly onCancel: () => void
}

/**
 * Draw a bordered panel around already-bounded content lines.
 * @param content - inner lines.
 * @param width - total panel width.
 * @param theme - active theme.
 * @returns panel lines, each exactly `width` columns.
 */
export function renderFrame(content: readonly string[], width: number, theme: Theme): string[] {
  const total = Math.max(12, width)
  const inner = Math.max(1, total - 4)
  const top = `┌${'─'.repeat(total - 2)}┐`
  const bottom = `└${'─'.repeat(total - 2)}┘`
  const rows = content.map((line) => {
    const clipped = truncateToWidth(line, inner)
    const padding = ' '.repeat(Math.max(0, inner - visibleWidth(clipped)))
    return `${theme.border('│')} ${clipped}${padding} ${theme.border('│')}`
  })
  return [theme.border(top), ...rows, theme.border(bottom)]
}

/**
 * Resolve the outer and inner widths of a dialog.
 * @param width - requested overlay width.
 * @returns the panel width and its content width.
 */
export function dialogWidths(width: number): { total: number; inner: number } {
  const total = Math.max(12, width)
  return { total, inner: Math.max(1, total - 4) }
}

/**
 * Render a dialog title and optional supporting text.
 * @param title - dialog title.
 * @param detail - optional supporting text.
 * @param inner - content width.
 * @param theme - active theme.
 * @returns title lines followed by a blank separator.
 */
export function dialogHeader(title: string, detail: string | undefined, inner: number, theme: Theme): string[] {
  const content: string[] = [theme.bold(title), '']
  if (detail !== undefined && detail.trim() !== '') {
    for (const line of wrapTextWithAnsi(detail, inner)) content.push(theme.dim(line))
    content.push('')
  }
  return content
}

/**
 * Render the hint line shown under a dialog's content.
 * @param hint - operation hint.
 * @param inner - content width.
 * @param theme - active theme.
 * @returns the bounded hint line.
 */
export function dialogHint(hint: string, inner: number, theme: Theme): string {
  return truncateToWidth(theme.dim(` ${hint}`), inner)
}

/** A selectable list inside a bordered panel, focused by the overlay itself. */
export class ChoiceDialog implements Component {
  private readonly options: ChoiceDialogOptions
  private readonly theme: Theme
  private readonly list: SelectList

  /**
   * @param options - dialog content and callbacks.
   * @param theme - active theme.
   */
  constructor(options: ChoiceDialogOptions, theme: Theme) {
    this.options = options
    this.theme = theme
    this.list = new SelectList([...options.items], Math.min(6, Math.max(1, options.items.length)), theme.select)
    this.list.onSelect = (item) => { options.onChoose(item.value) }
    this.list.onCancel = () => { options.onCancel() }
  }

  /** Clear cached render state. */
  invalidate(): void {
    this.list.invalidate()
  }

  /**
   * Route keys to the list; the overlay container owns focus.
   * @param data - raw terminal input.
   */
  handleInput(data: string): void {
    this.list.handleInput(data)
  }

  /**
   * Render the dialog.
   * @param width - overlay width.
   * @returns panel lines, each at most `width` columns.
   */
  render(width: number): string[] {
    const { total, inner } = dialogWidths(width)
    const content = dialogHeader(this.options.title, this.options.detail, inner, this.theme)
    content.push(...this.list.render(inner))
    content.push('')
    content.push(dialogHint(this.options.hint, inner, this.theme))
    return renderFrame(content, total, this.theme)
  }
}
