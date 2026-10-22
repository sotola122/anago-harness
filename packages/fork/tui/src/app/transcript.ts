/**
 * Transcript component: renders projected blocks through pi-tui primitives.
 * @module @anago-harness/tui/app/transcript
 */

import {
  Markdown,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
} from '../term/pi-tui.ts'
import type { DisplayBlock, TranscriptState } from '../projection/blocks.ts'
import type { Theme } from './theme.ts'

/** Left gutter used for every block. */
const GUTTER = '  '

/**
 * Wrap one styled body under a heading.
 * @param heading - already styled heading line.
 * @param body - plain body text.
 * @param width - available terminal width.
 * @param style - block body style.
 * @returns rendered lines, each at most `width` columns.
 */
function renderBlock(heading: string, body: string, width: number, style: (text: string) => string): string[] {
  const lines = [truncateToWidth(heading, width)]
  const contentWidth = Math.max(1, width - visibleWidth(GUTTER))
  for (const line of wrapTextWithAnsi(body, contentWidth)) {
    lines.push(truncateToWidth(`${GUTTER}${style(line)}`, width))
  }
  return lines
}

/**
 * Render an assistant message through the pi-tui Markdown component.
 * @param text - markdown source.
 * @param streaming - whether the message is still being produced.
 * @param width - available terminal width.
 * @param theme - active theme.
 * @returns rendered lines.
 */
function renderAssistant(text: string, streaming: boolean, width: number, theme: Theme): string[] {
  const marker = streaming ? theme.dim(' …') : ''
  const heading = `${theme.assistant('◆ assistant')}${marker}`
  if (text === '') return [truncateToWidth(heading, width)]
  const markdown = new Markdown(text, 0, 0, theme.markdown)
  const lines = [truncateToWidth(heading, width)]
  const contentWidth = Math.max(1, width - visibleWidth(GUTTER))
  for (const line of markdown.render(contentWidth)) {
    lines.push(truncateToWidth(`${GUTTER}${line}`, width))
  }
  return lines
}

/**
 * Render one display block.
 * @param block - block model.
 * @param width - available terminal width.
 * @param theme - active theme.
 * @returns rendered lines.
 */
function renderBlockRow(block: DisplayBlock, width: number, theme: Theme): string[] {
  switch (block.kind) {
    case 'user':
      return renderBlock(theme.user('❯ you'), block.text, width, theme.user)
    case 'assistant':
      return renderAssistant(block.text, block.streaming, width, theme)
    case 'tool': {
      const icon = block.status === 'running' ? '…' : block.status === 'ok' ? '✓' : '✗'
      const color = block.status === 'error' ? theme.error : theme.tool
      const heading = `${color(`${icon} ${block.name}`)}${block.summary === '' ? '' : theme.dim(` · ${block.summary}`)}`
      const lines = [truncateToWidth(heading, width)]
      if (block.result !== undefined && block.result !== '') {
        lines.push(truncateToWidth(`${GUTTER}${theme.dim(`└ ${block.result}`)}`, width))
      }
      return lines
    }
    case 'error':
      return renderBlock(theme.error('✗ error'), block.text, width, theme.error)
    case 'notice':
      return [truncateToWidth(theme.notice(`· ${block.text}`), width)]
  }
}

/** Scrollable transcript view driven entirely by {@link TranscriptState}. */
export class TranscriptView implements Component {
  private state: TranscriptState
  private readonly theme: Theme

  /**
   * @param theme - active theme.
   * @param state - initial projection state.
   */
  constructor(theme: Theme, state: TranscriptState) {
    this.theme = theme
    this.state = state
  }

  /**
   * Replace the displayed projection.
   * @param state - next projection state.
   */
  setState(state: TranscriptState): void {
    this.state = state
  }

  /**
   * Projection the transcript currently renders.
   * @returns the last state handed to {@link setState}.
   */
  getState(): TranscriptState {
    return this.state
  }

  /** Clear cached render state. */
  invalidate(): void {}

  /**
   * Render the transcript.
   * @param width - available terminal width.
   * @returns one line per row, each at most `width` columns.
   */
  render(width: number): string[] {
    const limit = Math.max(1, width)
    const lines: string[] = []
    if (this.state.title !== null && this.state.title.trim() !== '') {
      lines.push(truncateToWidth(this.theme.bold(this.state.title), limit))
      lines.push('')
    }
    for (const block of this.state.blocks) {
      if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('')
      lines.push(...renderBlockRow(block, limit, this.theme))
    }
    if (this.state.liveAssistant !== '') {
      if (lines.length > 0) lines.push('')
      lines.push(...renderAssistant(this.state.liveAssistant, true, limit, this.theme))
    }
    if (lines.length === 0) {
      lines.push(truncateToWidth(this.theme.notice('No messages yet. Type below and press Enter.'), limit))
    }
    return lines
  }
}
