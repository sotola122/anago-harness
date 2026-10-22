/**
 * Footer status line: model route, lifecycle state, Session id, and the
 * transient key hint.
 * @module @anago-harness/tui/app/status
 */

import { truncateToWidth, type Component } from '../term/pi-tui.ts'
import type { Theme } from './theme.ts'

/** Display facts rendered by {@link StatusView}. */
export interface StatusFields {
  /** Model id reported by the Agent, when one is open. */
  model: string
  /** Provider route reported by the Agent, when one is open. */
  provider: string
  /** Session identity, shortened for the footer. */
  sessionId: string
  /** Lifecycle state. */
  status: 'idle' | 'running'
  /** Transient hint such as the Ctrl+C confirmation. */
  hint: string
}

/** One-line footer component. */
export class StatusView implements Component {
  private readonly theme: Theme
  private fields: StatusFields

  /**
   * @param theme - active theme.
   * @param fields - initial display facts.
   */
  constructor(theme: Theme, fields: StatusFields) {
    this.theme = theme
    this.fields = fields
  }

  /**
   * Replace the displayed facts.
   * @param fields - next display facts.
   */
  setFields(fields: StatusFields): void {
    this.fields = fields
  }

  /**
   * Facts the footer currently displays.
   * @returns the last fields handed to {@link setFields}.
   */
  getFields(): StatusFields {
    return this.fields
  }

  /** Clear cached render state. */
  invalidate(): void {}

  /**
   * Render the footer.
   * @param width - available terminal width.
   * @returns exactly one bounded line.
   */
  render(width: number): string[] {
    const { provider, model, sessionId, status, hint } = this.fields
    const route = [provider, model].filter(value => value !== '').join(' · ') || 'model pending'
    const state = status === 'running' ? this.theme.accent('running') : this.theme.success('idle')
    const parts = [route, state]
    if (sessionId !== '') parts.push(this.theme.dim(`session ${sessionId.slice(0, 8)}`))
    if (hint !== '') parts.push(this.theme.dim(hint))
    return [truncateToWidth(parts.join(this.theme.dim(' · ')), Math.max(1, width))]
  }
}
