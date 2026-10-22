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
import type { DisplayBlock, ReasoningBlock, ToolBlock, TranscriptState } from '../projection/blocks.ts'
import { formatDuration, summarizeText } from '../projection/tools.ts'
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
 * Expand a multi-line body under the gutter.
 * @param text - body text.
 * @param width - available terminal width.
 * @param style - body style.
 * @returns one bounded line per source line.
 */
function renderBody(text: string, width: number, style: (line: string) => string): string[] {
  const contentWidth = Math.max(1, width - visibleWidth(GUTTER))
  const lines: string[] = []
  for (const source of text.split('\n')) {
    for (const line of wrapTextWithAnsi(source, contentWidth)) lines.push(`${GUTTER}${style(line)}`)
  }
  return lines
}

/**
 * Render the collapsed or expanded detail of a tool card.
 * @param block - tool block.
 * @param width - available terminal width.
 * @param theme - active theme.
 * @returns detail lines.
 */
function renderToolDetail(block: ToolBlock, width: number, theme: Theme): string[] {
  const lines: string[] = []
  if (block.detail !== undefined) {
    lines.push(truncateToWidth(`${GUTTER}${theme.dim(`  ${block.detail}`)}`, width))
  }
  if (block.expanded) {
    if (block.output !== undefined && block.output !== '') {
      lines.push(...renderBody(block.output, width, theme.tool))
    }
    if (block.facts.length > 0) {
      lines.push(truncateToWidth(`${GUTTER}${theme.dim(block.facts.join(' · '))}`, width))
    }
    return lines
  }
  if (block.result !== undefined && block.result !== '') {
    lines.push(truncateToWidth(`${GUTTER}${theme.dim(`└ ${block.result}`)}`, width))
  }
  return lines
}

/**
 * Render a tool card compactly: heading, identifying detail, and a preview or
 * the expanded result.
 * @param block - tool block.
 * @param width - available terminal width.
 * @param theme - active theme.
 * @returns rendered lines.
 */
function renderTool(block: ToolBlock, width: number, theme: Theme): string[] {
  const icon = block.status === 'running' ? '…' : block.status === 'ok' ? '✓' : '✗'
  const color = block.status === 'error' ? theme.error : theme.tool
  const caret = block.detail !== undefined || block.output !== undefined || block.facts.length > 0
    ? `${block.expanded ? '▾' : '▸'} `
    : ''
  const parts = [`${caret}${icon} ${block.name}`]
  if (block.summary !== '' && block.summary !== block.name) parts.push(block.summary)
  for (const fact of block.facts) parts.push(fact)
  if (block.durationMs !== undefined) parts.push(formatDuration(block.durationMs))
  const heading = color(parts[0] as string)
    + (parts.length === 1 ? '' : theme.dim(` · ${parts.slice(1).join(' · ')}`))
  return [truncateToWidth(heading, width), ...renderToolDetail(block, width, theme)]
}

/**
 * Render a reasoning summary, collapsed to its first line unless expanded.
 * @param block - reasoning block.
 * @param width - available terminal width.
 * @param theme - active theme.
 * @returns rendered lines.
 */
function renderReasoning(block: ReasoningBlock, width: number, theme: Theme): string[] {
  const caret = block.expanded ? '▾' : '▸'
  const chars = `${String(block.text.length)} chars`
  const heading = theme.dim(`${caret} ◇ reasoning · ${chars}`)
  const lines = [truncateToWidth(heading, width)]
  if (block.expanded) {
    lines.push(...renderBody(block.text, width, theme.dim))
    return lines
  }
  const preview = summarizeText(block.text.split('\n')[0] as string)
  if (preview !== '') lines.push(truncateToWidth(`${GUTTER}${theme.dim(`└ ${preview}`)}`, width))
  return lines
}

/**
 * Render the streaming reasoning row.
 * @param text - reasoning accumulated for the in-progress message.
 * @param width - available terminal width.
 * @param theme - active theme.
 * @returns rendered lines.
 */
function renderLiveReasoning(text: string, width: number, theme: Theme): string[] {
  const heading = theme.dim(`◇ thinking… · ${String(text.length)} chars`)
  return [truncateToWidth(heading, width)]
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
    case 'reasoning':
      return renderReasoning(block, width, theme)
    case 'tool':
      return renderTool(block, width, theme)
    case 'error':
      return renderBlock(theme.error('✗ error'), block.text, width, theme.error)
    case 'notice': {
      const lines = block.text.split('\n')
      return lines.map((line, index) => truncateToWidth(
        index === 0 ? theme.notice(`· ${line}`) : theme.notice(`  ${line}`),
        width,
      ))
    }
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
    if (this.state.liveReasoning !== '' || this.state.liveAssistant !== '') {
      if (lines.length > 0) lines.push('')
      if (this.state.liveReasoning !== '') {
        lines.push(...renderLiveReasoning(this.state.liveReasoning, limit, this.theme))
      }
      if (this.state.liveAssistant !== '') {
        lines.push(...renderAssistant(this.state.liveAssistant, true, limit, this.theme))
      }
    }
    if (lines.length === 0) {
      lines.push(truncateToWidth(
        this.theme.notice('No messages yet. Type below and press Enter, or /help for commands.'),
        limit,
      ))
    }
    return lines
  }
}
