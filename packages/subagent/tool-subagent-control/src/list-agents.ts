/** Discover the caller's entire subagent tree; the control plugin owns registration. */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { foldSubagentDescriptor } from '@deepseek-ai/dsh-subagent'
import type { SubagentDescendantListEntry } from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-session-query'

/** Recorded LLM route fields. Absent fields were not declared for that child. */
interface RecordedRoute {
  readonly provider?: string
  readonly model?: string
  readonly reasoningEffort?: string
}

type ListAgentsEntry =
  | {
    readonly kind: 'root'
    readonly id: SessionId
    readonly status: 'running' | 'inactive'
  }
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

/** Report turn activity without exposing whether the child is loaded. */
function statusOf(agents: { get(id: SessionId): Agent | undefined }, id: SessionId): 'running' | 'inactive' {
  return agents.get(id)?.status === 'running' ? 'running' : 'inactive'
}

/** Route fields as they arrive from agent options or a catalog entry. */
type RouteSource = {
  provider?: string | undefined
  model?: string | undefined
  reasoningEffort?: string | undefined
}

/** Copy only the route fields that were actually set. */
function routeFrom(source: RouteSource | undefined): RecordedRoute {
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
  entry: SubagentDescendantListEntry,
): ListAgentsEntry | undefined {
  const at = { parent: entry.parentId, depth: entry.depth }
  if (entry.kind === 'diagnostic') {
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
 * @returns the registered definition for scoped availability checks.
 */
export function registerListAgents(ctx: Context): ToolDefinition {
  const definition = defineTool({
    name: 'list_agents',
    description:
      'List your entire subagent tree: the root agent and all reachable continuable descendants, including yourself. '
      + 'Rows carry ids, descriptions, status, and recorded provider, model, and reasoning effort; descendant rows carry parent ids and depth from the root. '
      + 'You can message any other agent in the subagent tree listed as running or inactive. '
      + 'running means it is working; inactive means no turn is executing; it does not indicate task completion, success, or failure. '
      + 'While you remain active, you will be notified when a direct child finishes; there is no need to keep checking its status. '
      + 'Use send_message to continue the conversation.',
    parameters: {},
    output: {
      schema: {
        type: 'array',
        items: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: { type: 'string', required: true, enum: ['root'] },
                id: { type: 'string', required: true },
                status: { type: 'string', required: true, enum: ['running', 'inactive'] },
              },
            },
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
      render: (_args, entries) => {
        return [{
          type: 'text',
          text: entries.map((entry) => {
            if (entry.kind === 'root') return `${entry.id} [${entry.status}] — root agent`
            const at = ` parent=${String(entry.parent)} depth=${String(entry.depth)}`
            return entry.kind === 'diagnostic'
              ? `${entry.id} [diagnostic: ${entry.reason}]${at}`
              : `${entry.id} [${entry.status}]${routeClause(entry)}${at} — ${entry.label}`
          }).join('\n'),
        }]
      },
    },
    async execute(_args, exec) {
      const parent = exec.agent
      if (!parent) {
        // Non-agent callers have no session whose children could be listed.
        throw new Error('list_agents requires a calling agent (exec.agent was undefined)')
      }
      const root = ctx.subagents.rootOf(parent)
      const entries = await ctx.subagents.listDescendants(root.id, exec.signal)
      return [
        { kind: 'root' as const, id: root.id, status: statusOf(ctx.agents, root.id) },
        ...await enrichRoutes(ctx, entries
          .map(entry => project(ctx.agents, entry))
          .filter(entry => entry !== undefined), exec.signal),
      ]
    },
  })
  ctx.tools.register(definition)
  return definition
}
