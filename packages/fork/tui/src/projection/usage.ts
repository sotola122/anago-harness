/**
 * Pure per-turn token accounting for the footer.
 *
 * A turn's usage is the sum of the `assistant/message` usage records it
 * contains; the projection resets the accumulator at `turn/start` and keeps the
 * last turn's total visible while the Agent is idle. A provider that reports no
 * usage leaves the accumulator empty, so the footer simply omits the segment.
 * @module @anago-harness/tui/projection/usage
 */

import type { TokenUsage } from '@deepseek-ai/dsh-llm'

/** Token counts accumulated over one turn. */
export interface TurnUsage {
  /** Prompt tokens across every reported request in the turn. */
  readonly inputTokens: number
  /** Completion tokens across every reported request in the turn. */
  readonly outputTokens: number
  /** Reasoning tokens included in the completion counts, when the provider reports them. */
  readonly reasoningTokens: number
  /** Number of assistant messages that reported usage. */
  readonly requests: number
}

/** A turn with no reported usage. */
export const EMPTY_USAGE: TurnUsage = Object.freeze({
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  requests: 0,
})

/**
 * Add one reported request to a turn accumulator.
 * @param current - totals before this request.
 * @param usage - provider-reported counts for one assistant message.
 * @returns the updated totals.
 */
export function addUsage(current: TurnUsage, usage: TokenUsage): TurnUsage {
  return {
    inputTokens: current.inputTokens + usage.inputTokens,
    outputTokens: current.outputTokens + usage.outputTokens,
    reasoningTokens: current.reasoningTokens + (usage.reasoningTokens ?? 0),
    requests: current.requests + 1,
  }
}

/**
 * Whether any request in the turn reported usage.
 * @param usage - accumulated totals.
 * @returns true when the footer should show counts.
 */
export function hasUsage(usage: TurnUsage): boolean {
  return usage.requests > 0
}

/**
 * Format one token count for a compact footer segment.
 * @param count - token count.
 * @returns the exact count below one thousand, otherwise a one-decimal `k` value.
 */
export function formatTokens(count: number): string {
  if (count < 1_000) return String(count)
  const thousands = count / 1_000
  return `${thousands < 10 ? thousands.toFixed(1) : String(Math.round(thousands))}k`
}

/**
 * Format a turn's input and output counts.
 * @param usage - accumulated totals.
 * @returns a segment such as `in 1.2k · out 345`, or an empty string without usage.
 */
export function formatUsage(usage: TurnUsage): string {
  if (!hasUsage(usage)) return ''
  const reasoning = usage.reasoningTokens === 0 ? '' : ` (${formatTokens(usage.reasoningTokens)} reasoning)`
  return `in ${formatTokens(usage.inputTokens)} · out ${formatTokens(usage.outputTokens)}${reasoning}`
}
