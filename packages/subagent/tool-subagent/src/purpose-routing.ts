/**
 * Closed purpose labels and the Host route table a delegation reads at call time.
 * `default` is a table slot, not a model-facing label: omitting `category` selects it.
 * @module @deepseek-ai/dsh-tool-subagent/purpose-routing
 */

import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import z from '@deepseek-ai/schemastery'

/** Model-facing purpose labels. Closed set; array order is the settings UI order. */
export const PURPOSE_CATEGORIES = ['light', 'medium', 'deep', 'review', 'writing'] as const

/** One model-facing purpose label. */
export type PurposeCategory = typeof PURPOSE_CATEGORIES[number]

/** Table rows: every model-facing label plus the row used when `category` is omitted. */
export const PURPOSE_ROUTE_SLOTS = [...PURPOSE_CATEGORIES, 'default'] as const

/** One required table row, including the omission slot. */
export type PurposeRouteSlot = typeof PURPOSE_ROUTE_SLOTS[number]

/** Slots whose list may hold several routes started in parallel. */
const FAN_OUT_SLOTS: ReadonlySet<PurposeRouteSlot> = new Set(['review'])

/** One fully specified child route. */
export interface PurposeRoute {
  /** Registered LLM provider id. */
  readonly provider: string
  /** Provider-owned exact model id. */
  readonly model: string
  /** Required: an omitted effort would leave inheritance across different models ambiguous. */
  readonly reasoningEffort: ReasoningEffortId
}

/**
 * Complete table: every slot is required.
 * A non-fan-out slot holds exactly one route. `review` holds one or more.
 */
export type PurposeRouteTable = { readonly [S in PurposeRouteSlot]: readonly PurposeRoute[] }

/** Settled outcome of one purpose-selected child route. */
export type PurposeRouteOutcome =
  | { readonly kind: 'started'; readonly childId: SessionId }
  | { readonly kind: 'not-started'; readonly reason: string }

/** Log-only parent record of one resolved purpose route. */
export interface PurposeRouteEvent {
  /** Tool call that resolved this route. */
  readonly toolCallId: ToolCallId
  /** Table row selected for this child. */
  readonly slot: PurposeRouteSlot
  /** Provider, model, and effort taken from that row. */
  readonly route: { readonly provider: string; readonly model: string; readonly reasoningEffort: string }
  /** Whether this child started. Readers end the union with `assertNever`. */
  readonly outcome: PurposeRouteOutcome
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Resolved child route for one purpose-routing delegation. Appended when
     * that child's outcome is committed. Log-only: it carries no `surfaceOp`
     * and never enters model history. Writers set `ignorable: true` so an
     * older reader can skip the record. No `SESSION_FORMAT_VERSION` bump.
     */
    'subagent/purpose-route': PurposeRouteEvent
  }
}

/**
 * Schema for one route. Effort is a string here: a branded id does not survive
 * `Volatile` snapshots. {@link purposeTableFromStored} brands it on read.
 * Cardinality and duplicates are checked by {@link assertPurposeRouteTable}.
 */
export const PurposeRouteSchema = z.object({
  provider: z.string().min(1).required(),
  model: z.string().min(1).required(),
  reasoningEffort: z.string().min(1).required(),
})

const purposeRouteList = z.array(PurposeRouteSchema).min(1)

/**
 * Schema for a complete table. A missing slot fails validation.
 * Empty lists, extra routes, and duplicate triples are rejected by {@link assertPurposeRouteTable}.
 */
export const PurposeRouteTableSchema = z.object({
  light: purposeRouteList.required(),
  medium: purposeRouteList.required(),
  deep: purposeRouteList.required(),
  review: purposeRouteList.required(),
  writing: purposeRouteList.required(),
  default: purposeRouteList.required(),
})

/** Table as stored in volatile config, before effort ids are branded. */
export type StoredPurposeRouteTable = { readonly [S in PurposeRouteSlot]: readonly StoredPurposeRoute[] }

/** One stored route. `reasoningEffort` is branded when the table is read. */
export interface StoredPurposeRoute {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort: string
}

/** Appended to a `purposeRouting: true` tool description. Pinned model-facing text. */
export const PURPOSE_TOOL_SENTENCE = 'Choose `category` to match the task; the runtime picks a suitable child model for it. Omit `category` for general work. If a subagent fails to start, ends with an error, or returns an unusable result, re-delegate the same task once with the same `category`. If the failed call omitted `category`, omit it again. If that also fails, stop retrying and report the failure.'

/** `category` parameter description. Pinned model-facing text. */
export const PURPOSE_CATEGORY_DESCRIPTION = 'Task purpose that selects the child model. `light`: quick lookups, small mechanical edits, short summaries. `medium`: ordinary implementation or investigation. `deep`: hard debugging, design, or long multi-step reasoning. `review`: independent review of a change, plan, or document; may start several reviewers in parallel, each reporting separately. `writing`: documentation, PR or issue text, translation, user-facing prose. Do not combine with `provider`, `model`, or `reasoning_effort`.'

/** Appended to route-argument descriptions when purpose routing and model selection are both on. */
export const CATEGORY_EXCLUSIVITY_SUFFIX = ' Do not combine with `category`.'

/**
 * Whether a string is one of the model-facing labels.
 * @param value - candidate label.
 * @returns whether `value` is a {@link PurposeCategory}.
 */
export function isPurposeCategory(value: string): value is PurposeCategory {
  return (PURPOSE_CATEGORIES as readonly string[]).includes(value)
}

/**
 * Whether a slot starts one child per route.
 * @param slot - table row.
 * @returns whether the slot fans out.
 */
export function isFanOutSlot(slot: PurposeRouteSlot): boolean {
  return FAN_OUT_SLOTS.has(slot)
}

/**
 * Reject an empty list, a second route on a non-review slot, or a duplicate triple.
 * A missing slot fails schema validation before this runs.
 * @param table - candidate table already accepted by {@link PurposeRouteTableSchema}.
 */
export function assertPurposeRouteTable(table: PurposeRouteTable): void {
  for (const slot of PURPOSE_ROUTE_SLOTS) {
    const routes = table[slot]
    if (routes.length === 0) {
      throw new Error(`purpose route slot "${slot}" requires at least one route`)
    }
    if (!FAN_OUT_SLOTS.has(slot) && routes.length !== 1) {
      throw new Error(`purpose route slot "${slot}" accepts exactly one route`)
    }
    const seen = new Set<string>()
    for (const route of routes) {
      const key = `${route.provider}\0${route.model}\0${route.reasoningEffort}`
      if (seen.has(key)) {
        throw new Error(`purpose route slot "${slot}" repeats route "${route.provider}/${route.model}/${route.reasoningEffort}"`)
      }
      seen.add(key)
    }
  }
}

/**
 * Return the routes for one slot. Does not take an attempt and does not rewrite an unknown slot.
 * @param table - validated purpose table.
 * @param slot - row to read.
 * @returns that row, in table order.
 */
export function resolvePurposeRoutes(table: PurposeRouteTable, slot: PurposeRouteSlot): readonly PurposeRoute[] {
  return table[slot]
}

/**
 * Brand stored efforts and reject an invalid table.
 * @param stored - table read from volatile config.
 * @returns a detached validated table.
 * @throws when a slot is missing, empty, over-filled, or repeats a triple.
 */
export function purposeTableFromStored(stored: StoredPurposeRouteTable): PurposeRouteTable {
  const copy = (slot: PurposeRouteSlot): PurposeRoute[] => {
    const routes = stored[slot]
    if (!Array.isArray(routes)) {
      throw new Error(`purpose route slot "${slot}" is required`)
    }
    return routes.map(route => ({
      provider: route.provider,
      model: route.model,
      reasoningEffort: ReasoningEffortId(route.reasoningEffort),
    }))
  }
  const table: PurposeRouteTable = {
    light: copy('light'),
    medium: copy('medium'),
    deep: copy('deep'),
    review: copy('review'),
    writing: copy('writing'),
    default: copy('default'),
  }
  assertPurposeRouteTable(table)
  return table
}

/**
 * Model-facing error when `category` is supplied and purpose routing is off.
 * @returns the error thrown from resolution.
 */
export function categoryUnavailableError(): Error {
  return new Error('category selection is not available for this tool')
}

/**
 * Model-facing error when `category` is combined with a route argument.
 * @returns the error thrown from resolution.
 */
export function categoryCombinedError(): Error {
  return new Error('`category` cannot be combined with `provider`, `model`, or `reasoning_effort`')
}

/**
 * Model-facing error for a label outside the closed set. It is not rewritten to `default`.
 * @param value - the rejected label.
 * @returns the error thrown from resolution.
 */
export function unknownCategoryError(value: string): Error {
  return new Error(`unknown category "${value}"; use light, medium, deep, review, or writing, or omit it`)
}

/**
 * Model-facing error when the settings service or table is missing at the call.
 * @returns the error thrown from resolution.
 */
export function purposeTableMissingError(): Error {
  return new Error('no child model is configured for this tool; report that to the user')
}

/**
 * Model-facing error when every selected route fails preflight or start.
 * An omitted category does not mention `default`. The cause stays off this message.
 * @param slot - row that was selected.
 * @param categoryOmitted - whether the call omitted `category`.
 * @returns the error returned to the model.
 */
export function purposeUnavailableError(slot: PurposeRouteSlot, categoryOmitted: boolean): Error {
  if (categoryOmitted) {
    return new Error('the model for this delegation is unavailable; re-delegate once without `category`')
  }
  return new Error(`the model for category \`${slot}\` is unavailable; re-delegate once with the same \`category\``)
}
