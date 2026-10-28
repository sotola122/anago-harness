/**
 * Model-facing discovery of purpose labels and whether the default row resolves.
 * The result names no provider, model, or reasoning effort.
 * @module @deepseek-ai/dsh-tool-subagent/list-categories
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from './model-selection-settings.ts'
import {
  composeCategoryDescription,
  effectiveCategoryPurposes,
  isFanOutSlot,
  PURPOSE_CATEGORIES,
  purposeTableMissingError,
} from './purpose-routing.ts'
import type { PurposeCategory } from './purpose-routing.ts'

/** First sentence of {@link OMISSION_PURPOSE}, also the display prefix. */
const OMISSION_SENTENCE = 'Omitting category selects the configured default for general work'

/** Canonical omission text. `default` is not a label the caller may pass. */
const OMISSION_PURPOSE = `${OMISSION_SENTENCE}. The label default is not a category.`

/** Pinned model-facing description. */
const DESCRIPTION = 'List subagent category labels, the job each label is for, and whether omitting category currently selects a configured default. This tool does not list providers, models, or reasoning efforts. It does not choose a child. Pass a listed label as subagent category, or omit category for general work.'

interface CategoryRow {
  id: PurposeCategory
  purpose: string
  fanOut: boolean
}

interface ListSubagentCategoriesResult {
  categories: CategoryRow[]
  omission: {
    purpose: string
    configured: boolean
  }
}

/**
 * Whether the live table has a default row.
 * A missing service or a null table is unresolved, not an error.
 * A thrown table read is logged and replaced so route identifiers stay off the model result.
 * @param ctx - context that may hold the settings service.
 * @returns whether omitting `category` can resolve.
 */
function defaultConfigured(ctx: Context): boolean {
  const settings = ctx.get('subagentModelSelection')
  if (settings === undefined) return false
  try {
    const table = settings.purposeRoutes()
    return table !== null && table.default.length >= 1
  } catch (error: unknown) {
    ctx.logger.warn(`list_subagent_categories could not read the purpose table: ${String(error)}`)
    throw purposeTableMissingError()
  }
}

/**
 * Purpose clauses shared with the `category` parameter.
 * A guidance read that fails is logged and replaced so a route identifier
 * cannot reach the model result. The assemble path still throws that error.
 * @param ctx - context that may hold the settings service.
 * @returns the five clauses, built-in or deployment-authored.
 */
function categoryPurposes(ctx: Context): { readonly [C in PurposeCategory]: string } {
  const settings = ctx.get('subagentModelSelection')
  if (settings === undefined) return effectiveCategoryPurposes(null)
  try {
    const guidance = settings.purposeGuidance()
    const table = guidance === null ? null : settings.purposeRoutes()
    composeCategoryDescription(guidance, table)
    return effectiveCategoryPurposes(guidance)
  } catch (error: unknown) {
    ctx.logger.warn(`list_subagent_categories could not read purpose guidance: ${String(error)}`)
    throw purposeTableMissingError()
  }
}

/** Build the closed label list from the same clauses as the `category` parameter. */
function categoryRows(ctx: Context): CategoryRow[] {
  const purposes = categoryPurposes(ctx)
  return PURPOSE_CATEGORIES.map(id => ({
    id,
    purpose: purposes[id],
    fanOut: isFanOutSlot(id),
  }))
}

/** Compact display text. Chat history keeps this text, not the canonical value. */
function renderCategories(value: ListSubagentCategoriesResult): string {
  const lines = value.categories.map(row =>
    `${row.id} — ${row.purpose} — ${row.fanOut ? 'one child per configured route' : 'one child'}`)
  lines.push(`${OMISSION_SENTENCE}: ${value.omission.configured ? 'yes' : 'no'}`)
  return lines.join('\n')
}

/**
 * Register `list_subagent_categories` for one `purposeRouting` instance.
 * A second registration in the same tool scope fails at the registry.
 * @param ctx - context whose tool registry owns the fixed definition.
 */
export function registerListSubagentCategories(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'list_subagent_categories',
    description: DESCRIPTION,
    parameters: {},
    isConcurrencySafe: () => true,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          categories: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true, enum: [...PURPOSE_CATEGORIES] },
                purpose: { type: 'string', required: true },
                fanOut: { type: 'boolean', required: true },
              },
            },
          },
          omission: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              purpose: { type: 'string', required: true },
              configured: { type: 'boolean', required: true },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderCategories(value) }],
    },
    execute() {
      return Promise.resolve({
        categories: categoryRows(ctx),
        omission: {
          purpose: OMISSION_PURPOSE,
          configured: defaultConfigured(ctx),
        },
      })
    },
  }))
}
