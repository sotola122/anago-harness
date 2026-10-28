/**
 * The globally named `list_agents` tool: a thin model-facing adapter over
 * the continuable projection of `ctx.subagents.listChildren()` and, for the
 * `descendants` scope, `ctx.subagents.listDescendants()`. It stays separately
 * loadable from the root `send_message` plugin so a deployment can register
 * continuation delivery without exposing discovery.
 * @module @deepseek-ai/dsh-tool-subagent-control/list-agents
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { foldSubagentDescriptor } from '@deepseek-ai/dsh-subagent'
import type {
  SubagentCatalogEntry, SubagentDescendantListEntry, SubagentListEntry,
} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-session-query'
import { assertNever } from '@deepseek-ai/dsh-util-values'

export const name = 'tool-subagent-list-agents'
export const inject = ['tools', 'subagents', 'agents']

type ListAgentsScope = 'children' | 'descendants'

interface ListAgentsRequest {
  readonly scope?: ListAgentsScope
}

interface ListAgentsSpec {
  readonly scope: ListAgentsScope
}

/** Recorded LLM route fields. Absent fields were not declared for that child. */
interface RecordedRoute {
  readonly provider?: string
  readonly model?: string
  readonly reasoningEffort?: string
}

type ListAgentsEntry =
  | {
    readonly kind: 'child'
    readonly id: SessionId
    readonly label: string
    readonly status: 'running' | 'inactive'
    readonly provider?: string
    readonly model?: string
    readonly reasoningEffort?: string
    readonly parent?: SessionId
    readonly depth?: number
  }
  | {
    readonly kind: 'diagnostic'
    readonly id: SessionId
    readonly reason: 'corrupt' | 'unsupported' | 'unavailable'
    readonly parent?: SessionId
    readonly depth?: number
  }

/** Resolve the optional model request into an internal required-scope spec. */
function resolveListAgentsRequest(request: ListAgentsRequest): ListAgentsSpec {
  return { scope: request.scope ?? 'children' }
}

/** Report turn activity without exposing whether the child is loaded. */
function statusOf(agents: { get(id: SessionId): Agent | undefined }, id: SessionId): 'running' | 'inactive' {
  return agents.get(id)?.status === 'running' ? 'running' : 'inactive'
}

/** Copy only the route fields that were actually set. */
function routeFrom(source: { provider?: string; model?: string; reasoningEffort?: string } | undefined): RecordedRoute {
  if (source === undefined) return {}
  return {
    ...source.provider !== undefined ? { provider: source.provider } : {},
    ...source.model !== undefined ? { model: source.model } : {},
    ...source.reasoningEffort !== undefined ? { reasoningEffort: source.reasoningEffort } : {},
  }
}

/**
 * Route a listed child uses. A live Agent wins; otherwise the descriptor is the record.
 * An unreadable child log omits the route and keeps the listing row.
 * @param ctx - context carrying the Agent registry and Session query.
 * @param id - continuable child session id.
 * @param signal - listing cancellation.
 * @returns recorded provider, model, and reasoning effort, omitting unset fields.
 */
async function recordedRoute(ctx: Context, id: SessionId, signal: AbortSignal): Promise<RecordedRoute> {
  const live = ctx.agents.get(id)
  if (live !== undefined) return routeFrom(live.options)
  const query = ctx.get('sessionQuery')
  if (query === undefined) return {}
  try {
    using observed = await query.observeSession(id, { signal })
    const descriptor = foldSubagentDescriptor(observed.events)
    if (descriptor === undefined || descriptor.mode !== 'continuable') return {}
    return {
      ...descriptor.agentProvider !== undefined ? { provider: descriptor.agentProvider } : {},
      ...descriptor.agentModel !== undefined ? { model: descriptor.agentModel } : {},
      ...descriptor.agentReasoningEffort !== undefined ? { reasoningEffort: descriptor.agentReasoningEffort } : {},
    }
  } catch (error) {
    if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) throw error
    return {}
  }
}

/** Attach each continuable child's recorded route. Diagnostics stay unchanged. */
async function enrichRoutes(
  ctx: Context,
  entries: readonly ListAgentsEntry[],
  signal: AbortSignal,
): Promise<ListAgentsEntry[]> {
  const enriched: ListAgentsEntry[] = []
  for (const entry of entries) {
    if (entry.kind !== 'child') {
      enriched.push(entry)
      continue
    }
    const route = await recordedRoute(ctx, entry.id, signal)
    enriched.push({ ...entry, ...route })
  }
  return enriched
}

/** Model-facing route clause. Tokens cannot contain spaces. */
function routeClause(entry: RecordedRoute): string {
  // shortcut: route tokens cannot contain spaces, upgrade if a provider id can.
  const parts: string[] = []
  if (entry.provider !== undefined) parts.push(`provider=${entry.provider}`)
  if (entry.model !== undefined) parts.push(`model=${entry.model}`)
  if (entry.reasoningEffort !== undefined) parts.push(`effort=${entry.reasoningEffort}`)
  return parts.length === 0 ? '' : ` ${parts.join(' ')}`
}

/** Project one service row into the model-facing entry, or omit a one-shot child. */
function project(
  agents: { get(id: SessionId): Agent | undefined },
  entry: SubagentCatalogEntry | SubagentListEntry,
  position?: Pick<SubagentDescendantListEntry, 'parentId' | 'depth'>,
): ListAgentsEntry | undefined {
  const at = position === undefined ? {} : { parent: position.parentId, depth: position.depth }
  if ('kind' in entry && entry.kind === 'diagnostic') {
    return { kind: 'diagnostic', id: entry.id, reason: entry.reason, ...at }
  }
  // One-shot children cannot be continued by send_message, so the model
  // never selects them; discovery still traversed them for descendants.
  if (entry.mode !== 'continuable') return undefined
  return {
    kind: 'child',
    id: entry.id,
    label: entry.label,
    status: statusOf(agents, entry.id),
    ...at,
  }
}

/**
 * Register the `list_agents` tool.
 * @param ctx - context carrying the tool registry, subagent service, and live Agent registry.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'list_agents',
    description:
      'List subagents you started, with their ids, labels, status, and recorded provider, model, and reasoning effort. '
      + 'running means it is working; inactive means it is not currently working. '
      + 'You will be notified when a subagent finishes; there is no need to keep checking its status. '
      + 'Use send_message to continue the conversation.',
    parameters: {
      scope: {
        type: 'string',
        enum: ['children', 'descendants'],
        description: 'children (default) lists direct children, which accept send_message in any status. '
          + 'descendants lists the whole tree below you with each entry\'s parent session id and depth; entries deeper than 1 accept only interrupt_agent.',
      },
    },
    output: {
      schema: {
        type: 'array',
        items: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: { type: 'string', required: true, enum: ['child'] },
                id: { type: 'string', required: true },
                label: { type: 'string', required: true },
                status: { type: 'string', required: true, enum: ['running', 'inactive'] },
                provider: { type: 'string' },
                model: { type: 'string' },
                reasoningEffort: { type: 'string' },
                parent: { type: 'string' },
                depth: { type: 'number' },
              },
            },
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: { type: 'string', required: true, enum: ['diagnostic'] },
                id: { type: 'string', required: true },
                reason: { type: 'string', required: true, enum: ['corrupt', 'unsupported', 'unavailable'] },
                parent: { type: 'string' },
                depth: { type: 'number' },
              },
            },
          ],
        },
      },
      render: (args, entries) => {
        const request = resolveListAgentsRequest(args)
        return [{
          type: 'text',
          text: entries.length === 0
            ? '(no subagents)'
            : entries.map((entry) => {
              // A descendants row always carries its position; children rows
              // never render it. String() spans the schema-optional shape
              // without a dead fallback branch.
              const at = request.scope === 'descendants'
                ? ` parent=${String(entry.parent)} depth=${String(entry.depth)}`
                : ''
              return entry.kind === 'child'
                ? `${entry.id} [${entry.status}]${routeClause(entry)}${at} — ${entry.label}`
                : `${entry.id} [diagnostic: ${entry.reason}]${at}`
            }).join('\n'),
        }]
      },
    },
    async execute(args, exec) {
      const parent = exec.agent
      if (!parent) {
        // Non-agent callers have no session whose children could be listed.
        throw new Error('list_agents requires a calling agent (exec.agent was undefined)')
      }
      const request = resolveListAgentsRequest(args)
      switch (request.scope) {
        case 'children': {
          const entries = await ctx.subagents.listChildren(parent.id, exec.signal)
          return enrichRoutes(ctx, entries
            .map(entry => project(ctx.agents, entry))
            .filter(entry => entry !== undefined), exec.signal)
        }
        case 'descendants': {
          const entries = await ctx.subagents.listDescendants(parent.id, exec.signal)
          return enrichRoutes(ctx, entries
            .map(entry => project(ctx.agents, entry, entry))
            .filter(entry => entry !== undefined), exec.signal)
        }
        /* v8 ignore next 2 -- the resolver normalizes the schema-validated closed scope before dispatch. */
        default:
          return assertNever(request.scope, 'list_agents scope')
      }
    },
  }))
}
