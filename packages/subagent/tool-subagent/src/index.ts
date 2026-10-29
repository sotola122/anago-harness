/**
 * Model-facing delegation through one configured `ctx.subagents` provider.
 * Provider lifecycle controls tool registration and context-sensitive schema
 * wording. Every delegation starts a managed activation and returns its child
 * id; the subagent runtime owns result delivery and resource cleanup.
 * @module @deepseek-ai/dsh-tool-subagent
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { Agent, AgentOptions } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import {
  assertSubagentMaxDepth,
  delegationDepthOf,
  parentAgentOptionsForDelegation,
  resolveChildAgentOptions,
} from '@deepseek-ai/dsh-subagent'
import type { SubagentProvider } from '@deepseek-ai/dsh-subagent'
import {
  assertAllowedModelSelection,
  hasConfiguredLlmSelection,
  hasDelegationModelRequest,
  preflightChildLlmRoute,
  providerOwnedAgentOptions,
  requestedAgentOptions,
  resolveChildRoutes,
} from './model-selection.ts'
import type { ChildRouteResolution, DelegationModelRequest, ModelSelectionPolicy, ResolvedChildRoute } from './model-selection.ts'
import {
  CATEGORY_EXCLUSIVITY_SUFFIX,
  composeCategoryDescription,
  isFanOutSlot,
  PURPOSE_CATEGORIES,
  PURPOSE_TOOL_SENTENCE,
  purposeUnavailableError,
  splittingAddition,
} from './purpose-routing.ts'
import type { PurposeGuidance, PurposeRouteSlot, PurposeRouteTable } from './purpose-routing.ts'
import { registerListSubagentCategories } from './list-categories.ts'
import { registerListSubagentModels } from './list-models.ts'
import { SubagentPresetSelection, type PresetSelectionConfig, type PresetSelectionRequest } from './preset-selection.ts'
import {
  subagentModelSelectionProjectionDefinition,
  subagentModelSelectionPolicy,
} from './model-selection-state.ts'

export const name = 'tool-subagent'
export const inject = ['tools', 'subagents', 'systemPrompt', 'sessionProjections']

// Definition identity keeps shared guidance scoped to the actual visible tools,
// including scoped overrides and independently loaded tool registries.
const delegationTools = new Set<ToolDefinition>()

/** Whether a registered delegation tool resolves `category` from the purpose table. */
const purposeRoutingTools = new WeakMap<ToolDefinition, true>()

/**
 * Bookkeeping variable resolved before provider-owned tool snapshots.
 * Stripped from the presentation so it never reaches interpolation.
 */
const PURPOSE_CATEGORY_VARIABLE = 'subagent_purpose_category'

/**
 * Write a composed `category` description into a tool schema.
 * A schema without `category` is left unchanged.
 * @param parameters - a tool parameter schema, possibly a prompt-assembly clone.
 * @param description - the description to publish.
 * @returns whether `category` was present and updated.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function writeCategoryDescription(parameters: unknown, description: string): boolean {
  if (!isRecord(parameters)) return false
  const properties = parameters.properties
  if (!isRecord(properties)) return false
  const category = properties.category
  if (!isRecord(category) || typeof category.description !== 'string') return false
  category.description = description
  return true
}

/**
 * Compose the current category description from the settings service.
 * A missing service or a null guidance value keeps the pinned description.
 * An invalid or leaking guidance value throws and must not be published.
 * @param runtimeCtx - context that may hold the settings service.
 * @returns the description and the guidance used to build the splitting paragraph.
 */
function readPurposeCopy(runtimeCtx: Context): { description: string; guidance: PurposeGuidance | null; table: PurposeRouteTable | null } {
  const settings = runtimeCtx.get('subagentModelSelection')
  const guidance = settings === undefined ? null : settings.purposeGuidance()
  // A null guidance value does not read the table: route edits must not change the description.
  const table = guidance === null || settings === undefined ? null : settings.purposeRoutes()
  return { description: composeCategoryDescription(guidance, table), guidance, table }
}

/** Config: which registered provider this tool delegates to, plus child defaults. */
export interface Config extends PresetSelectionConfig {
  /** The `ctx.subagents` provider name to start runs on (e.g. `spawn`, `acp`). */
  provider: string
  /**
   * Model-facing tool name (default `subagent`). Each loaded instance must use
   * a distinct name.
   */
  toolName?: string
  /**
   * Expose optional child `provider`, `model`, and `reasoning_effort` fields.
   * Requires provider `agentOptions` support. Execution enforces the Session
   * policy, or restricts explicit selection to the current parent route.
   */
  modelSelection?: boolean
  /**
   * Register the shared `list_subagent_models` tool for this scope.
   * Enable on only one instance per scope; defaults to false and does not
   * enable model selection. Discovery is removed when this instance unloads.
   */
  modelDiscovery?: boolean
  /**
   * Fork extension: the provider interprets `provider` / `model` /
   * `reasoning_effort` itself (an external CLI with its own route
   * namespace). The tool exposes those arguments without the Host
   * model-selection policy or the DSH LLM-catalog preflight, and passes them
   * as `agentOptions` to the provider.
   */
  providerOwnedRoute?: boolean
  /**
   * Resolve each call from the live purpose table. Adds `category`. Cannot
   * combine with `providerOwnedRoute` or with `agentOptions` route fields
   * (`maxTokens` may combine). Requires the settings service and a non-null table.
   */
  purposeRouting?: boolean
  /**
   * Agent options applied to every child; omitted fields use child-loop defaults.
   */
  agentOptions?: AgentOptions
  /**
   * Maximum child depth: a non-negative safe integer (`0` forbids delegation),
   * or `'provider-managed'` to send no cap. A numeric cap
   * requires the provider's `depthLimit` capability (mount fails loud
   * otherwise). The provider checks the calling agent's current depth at every
   * start; the tool remains model-visible so runtime policy owns rejection.
   * `'provider-managed'` is for an out-of-process provider whose recursion
   * budget belongs to the child runtime or its own deployment. Omission reads
   * the current Host subagent depth setting (default `1`) at each delegation.
   */
  maxDepth?: number | 'provider-managed'
}

export const Config: z<Config> = z.object({
  provider: z.string().required(),
  toolName: z.string().default('subagent'),
  modelSelection: z.boolean().default(false),
  modelDiscovery: z.boolean().default(false),
  providerOwnedRoute: z.boolean().default(false),
  purposeRouting: z.boolean().default(false),
  // Prevent Schemastery from materializing omitted agentOptions as `{}`.
  agentOptions: z.object({
    provider: z.string(),
    model: z.string(),
    reasoningEffort: z.string().min(1) as z<ReturnType<typeof ReasoningEffortId> | undefined>,
    maxTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER),
  }).default(undefined as unknown as {
    provider: string
    model: string
    reasoningEffort: ReturnType<typeof ReasoningEffortId>
    maxTokens: number
  }),
  agentPreset: z.string().min(1),
  allowedAgentPresets: (z.array(z.string().min(1)).min(1) as z<string[] | undefined>).default(undefined),
  maxDepth: z.union([z.natural().max(Number.MAX_SAFE_INTEGER), z.const('provider-managed' as const)]),
})

/**
 * Model-facing wording from the provider's conversation-history descriptor
 * ({@link SubagentProvider.inheritsParentContext}).
 * A fresh child needs a standalone prompt; a forked child already sees the
 * conversation's completed turns — telling the model to restate everything
 * (or, worse, that the child "does not see this conversation") would be false
 * for a fork.
 * @param inheritsConversation - whether the child's conversation is seeded
 *   with the parent's completed turns; this says nothing about tool, service,
 *   scope, or authority inheritance.
 * @returns the tool `description` and the `prompt` parameter description.
 */
function providerWording(inheritsConversation: boolean): { description: string; promptDescription: string } {
  if (inheritsConversation) {
    return {
      description:
        'Delegate a task to a subagent that inherits this conversation: a child agent seeded with all '
        + 'completed turns so far (it does not see the current in-flight turn). Use this when the subtask '
        + 'builds on this conversation\'s context — a follow-up analysis, '
        + 'a review, a continuation — without consuming this conversation\'s context for the work itself. '
        + 'You receive its result, not its intermediate steps.',
      promptDescription:
        'The task for the subagent. It already sees this conversation\'s completed turns, so build on them '
        + 'freely and state only what is new.',
    }
  }
  return {
    description:
      'Delegate a self-contained task to a subagent (a separate agent that works in its own context) '
      + 'to offload focused, independent work — research, a scoped '
      + 'implementation, an analysis — so it does not consume this conversation\'s context. The subagent '
      + 'returns its result, not its intermediate steps.',
    promptDescription:
      'The complete, self-contained task for the subagent. It does not share this '
      + 'conversation\'s context, so include everything it needs.',
  }
}

/** Read `category` from tool arguments, including a call whose schema does not declare it. */
function categoryArgument(args: { category?: unknown }): string | undefined {
  if (args.category === undefined) return undefined
  return typeof args.category === 'string' ? args.category : ''
}

/** Text of a thrown value, kept for the log and the `not-started` event. */
function failureReason(error: unknown): string {
  return error instanceof Error && error.message.length > 0 ? error.message : String(error)
}

/** Whether a failure is the caller's abort rather than a route failure. */
function isAbort(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof Error && error.name === 'AbortError')
}

/** Provider, model, and reasoning effort a call actually passed to one child. */
interface UsedRoute {
  provider?: string
  model?: string
  reasoningEffort?: string
}

/** One attempted child. `subagentId` is absent when that reviewer did not start. */
interface ActivationChild extends UsedRoute {
  subagentId?: string
}

/** Result fields a delegation call may return. Review fan-out adds the list fields. */
interface ActivationResult extends UsedRoute {
  kind: 'activation'
  subagentId: string
  subagentIds?: string[]
  notStarted?: number
  /** Present for a review fan-out, in attempt order, including reviewers that did not start. */
  children?: ActivationChild[]
}

/**
 * Effective route the child runtime stamps from the parent plus this call's options.
 * @param parent - delegating parent whose route supplies omitted fields.
 * @param requested - per-child options passed to `startActivation`, if any.
 * @returns only the provider, model, and reasoning effort that were resolved.
 */
function usedRoute(parent: Agent, requested: AgentOptions | undefined): UsedRoute {
  const resolved = resolveChildAgentOptions(parent, requested, delegationDepthOf(parent) + 1)
  return {
    ...resolved.provider !== undefined ? { provider: resolved.provider } : {},
    ...resolved.model !== undefined ? { model: resolved.model } : {},
    ...resolved.reasoningEffort !== undefined ? { reasoningEffort: resolved.reasoningEffort } : {},
  }
}

/** Compact model and effort suffix. Provider stays in the structured result. */
function routeSuffix(route: UsedRoute): string {
  // shortcut: model and effort tokens cannot contain spaces, upgrade if an id can.
  const parts = [route.model, route.reasoningEffort].filter((part): part is string => part !== undefined && part !== '')
  return parts.length === 0 ? '' : ` · ${parts.join(' · ')}`
}

/** Model-facing text for one activation result, including a partial review fan-out. */
function renderActivation(value: ActivationResult): ContentBlock[] {
  const children = value.children
  const notStarted = value.notStarted ?? 0
  if (children !== undefined && (children.length > 1 || notStarted > 0)) {
    const ids = value.subagentIds ?? children.flatMap(child => child.subagentId === undefined ? [] : [child.subagentId])
    const noun = ids.length === 1 ? 'subagent' : 'subagents'
    let text = `started ${ids.length} ${noun}: ${ids.join(', ')}`
    if (notStarted > 0) {
      text += `; ${notStarted} ${notStarted === 1 ? 'reviewer' : 'reviewers'} could not start`
    }
    // Failed reviewer names stay off this text; the structured result still carries their routes.
    const lines = children.flatMap(child => child.subagentId === undefined
      ? []
      : [`started subagent ${child.subagentId}${routeSuffix(child)}`])
    return [{ type: 'text', text: [text, ...lines].join('\n') }]
  }
  return [{ type: 'text', text: `started subagent ${value.subagentId}${routeSuffix(value)}` }]
}

/** Replayable route facts for the Web card. Failed reviewers stay here, not in model-facing text. */
function activationMeta(value: ActivationResult) {
  return {
    subagentId: value.subagentId,
    ...value.provider !== undefined ? { provider: value.provider } : {},
    ...value.model !== undefined ? { model: value.model } : {},
    ...value.reasoningEffort !== undefined ? { reasoningEffort: value.reasoningEffort } : {},
    ...value.subagentIds !== undefined ? { subagentIds: [...value.subagentIds] } : {},
    ...value.notStarted !== undefined ? { notStarted: value.notStarted } : {},
    ...value.children !== undefined ? {
      children: value.children.map(child => ({
        ...child.subagentId !== undefined ? { subagentId: child.subagentId } : {},
        ...child.provider !== undefined ? { provider: child.provider } : {},
        ...child.model !== undefined ? { model: child.model } : {},
        ...child.reasoningEffort !== undefined ? { reasoningEffort: child.reasoningEffort } : {},
      })),
    } : {},
  }
}

/**
 * Preflight and start the children {@link resolveChildRoutes} selected.
 * A purpose selection skips the allowlist, records each outcome, and fans out `review`.
 * Abort stops children already started via `subagents.interrupt`.
 */
async function startResolvedChildren(input: {
  runtimeCtx: Context
  parent: Agent
  signal: AbortSignal
  callId: ToolCallId
  providerName: string
  subagentProvider: SubagentProvider
  resolution: ChildRouteResolution
  categoryOmitted: boolean
  parentOptions: AgentOptions
  policy: ModelSelectionPolicy | undefined
  modelRequest: DelegationModelRequest
  label: string
  prompt: ContentBlock[]
  cwd?: string
  agentPreset?: string
  maxDepth?: number
}): Promise<ActivationResult> {
  const {
    runtimeCtx, parent, signal, callId, providerName, subagentProvider, resolution,
    categoryOmitted, parentOptions, policy, modelRequest, label, prompt, cwd, agentPreset, maxDepth,
  } = input
  const slot: PurposeRouteSlot | undefined = resolution.source.kind === 'purpose' ? resolution.source.slot : undefined
  const fanOut = slot !== undefined && isFanOutSlot(slot)

  if (resolution.enforceAllowlist) {
    assertAllowedModelSelection(policy, parentOptions, resolution.children[0]?.options, modelRequest)
  }

  const ordered: ActivationChild[] = []
  const pending: Array<{ child: ResolvedChildRoute; index: number }> = []
  let notStarted = 0
  const queue = (child: ResolvedChildRoute, failed: boolean): void => {
    const index = ordered.length
    ordered.push(usedRoute(parent, child.options))
    if (failed) notStarted += 1
    else pending.push({ child, index })
  }
  if (slot !== undefined) {
    const llm = runtimeCtx.get('llm')
    for (const child of resolution.children) {
      signal.throwIfAborted()
      const route = child.route
      if (route === undefined) continue
      try {
        if (llm === undefined) {
          throw new Error('cannot resolve the selected child LLM route because the `llm` service is unavailable')
        }
        await preflightChildLlmRoute(llm, parentOptions, child.options, signal, false)
        queue(child, false)
      } catch (error) {
        if (isAbort(error, signal)) throw error
        queue(child, true)
        recordPurposeOutcome(runtimeCtx, parent, callId, slot, route, failureReason(error))
      }
    }
    if (pending.length === 0) throw purposeUnavailableError(slot, categoryOmitted)
  } else {
    const child = resolution.children[0]
    const llm = runtimeCtx.get('llm')
    if (llm === undefined) {
      throw new Error('cannot resolve the selected child LLM route because the `llm` service is unavailable')
    }
    await preflightChildLlmRoute(llm, parentOptions, child?.options, signal, false)
    if (child !== undefined) queue(child, false)
  }

  if (runtimeCtx.subagents.getProvider(providerName) !== subagentProvider) {
    throw new Error(`subagent provider "${providerName}" changed while resolving the child LLM route; retry the delegation`)
  }

  const startedIds: SessionId[] = []
  try {
    for (const item of pending) {
      const child = item.child
      signal.throwIfAborted()
      try {
        const started = await runtimeCtx.subagents.startActivation({
          provider: providerName,
          label,
          request: {
            prompt,
            parent,
            ...cwd === undefined ? {} : { cwd },
            ...agentPreset === undefined ? {} : { agentPreset },
            ...child.options !== undefined ? { agentOptions: child.options } : {},
            ...maxDepth !== undefined ? { maxDepth } : {},
          },
          signal,
          delivery: 'parent',
        })
        startedIds.push(started.childId)
        const placed = ordered[item.index]
        if (placed !== undefined) ordered[item.index] = { ...placed, subagentId: started.childId }
        if (slot !== undefined && child.route !== undefined) {
          parent.session.append('subagent/purpose-route', {
            toolCallId: callId,
            slot,
            route: {
              provider: child.route.provider,
              model: child.route.model,
              reasoningEffort: child.route.reasoningEffort,
            },
            outcome: { kind: 'started', childId: started.childId },
          }, { ignorable: true })
        }
      } catch (error) {
        if (isAbort(error, signal)) throw error
        notStarted += 1
        if (slot !== undefined && child.route !== undefined) {
          recordPurposeOutcome(runtimeCtx, parent, callId, slot, child.route, failureReason(error))
        }
        if (!fanOut) throw slot === undefined ? error : purposeUnavailableError(slot, categoryOmitted)
      }
    }
  } catch (error) {
    if (isAbort(error, signal)) {
      for (const id of startedIds) {
        try {
          runtimeCtx.subagents.interrupt(id, { kind: 'ancestor', agent: parent })
        } catch (stopError) {
          runtimeCtx.logger.warn(`subagent purpose routing could not stop ${id}: ${failureReason(stopError)}`)
        }
      }
      throw error
    }
    throw error
  }

  const first = startedIds[0]
  if (first === undefined) {
    throw slot === undefined
      ? new Error('the selected child model is unavailable; re-delegate once')
      : purposeUnavailableError(slot, categoryOmitted)
  }
  const primary = ordered.find(child => child.subagentId === first) ?? {}
  const route = {
    ...primary.provider !== undefined ? { provider: primary.provider } : {},
    ...primary.model !== undefined ? { model: primary.model } : {},
    ...primary.reasoningEffort !== undefined ? { reasoningEffort: primary.reasoningEffort } : {},
  }
  if (fanOut) {
    return { kind: 'activation', subagentId: first, subagentIds: startedIds, notStarted, ...route, children: ordered }
  }
  return { kind: 'activation', subagentId: first, ...route }
}

/** Append a not-started purpose route and log the cause the model does not see. */
function recordPurposeOutcome(
  runtimeCtx: Context,
  parent: Agent,
  callId: ToolCallId,
  slot: PurposeRouteSlot,
  route: { provider: string; model: string; reasoningEffort: string },
  reason: string,
): void {
  runtimeCtx.logger.warn(`subagent purpose route ${route.provider}/${route.model} did not start: ${reason}`)
  parent.session.append('subagent/purpose-route', {
    toolCallId: callId,
    slot,
    route: { provider: route.provider, model: route.model, reasoningEffort: route.reasoningEffort },
    outcome: { kind: 'not-started', reason },
  }, { ignorable: true })
}

/**
 * Install one delegation-tool composition.
 * The owning composition shares its registrations across Agents; child startup resolves the selected preset.
 * @param ctx - Context that owns the registrations.
 * @param config - delegation-tool configuration.
 * @returns when the plugin is ready.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  for (const field of ['persona', 'toolFilter']) {
    if (Object.hasOwn(config, field)) {
      throw new Error(`tool-subagent: ${field} is no longer supported; configure persona and tool plugins in an Agent Preset and select it with agentPreset (spawn only)`)
    }
  }
  const purposeRouting = config.purposeRouting === true
  if (purposeRouting) {
    if (config.providerOwnedRoute === true) {
      throw new Error('tool-subagent: purposeRouting cannot be combined with providerOwnedRoute')
    }
    const options = config.agentOptions
    if (options?.provider !== undefined || options?.model !== undefined || options?.reasoningEffort !== undefined) {
      throw new Error('tool-subagent: purposeRouting cannot be combined with agentOptions provider, model, or reasoningEffort')
    }
    const settings = ctx.get('subagentModelSelection')
    if (settings === undefined) {
      throw new Error(
        'tool-subagent: purposeRouting requires '
        + '@deepseek-ai/dsh-tool-subagent/model-selection-settings in the Host scope',
      )
    }
    if (settings.purposeRoutes() === null) {
      throw new Error('tool-subagent: purposeRouting requires a purposeRoutes table')
    }
  }
  const presets = new SubagentPresetSelection(config)
  if (presets.configured && ctx.get('agentPresets') === undefined) {
    throw new Error('tool-subagent: agent preset selection requires the agent-presets service')
  }
  // Direct apply() bypasses Schemastery's numeric constraints. A direct-apply
  // omission stays capless (the schema default only runs through the loader).
  if (config.maxDepth !== 'provider-managed') assertSubagentMaxDepth(config.maxDepth)
  const toolName = config.toolName ?? 'subagent'

  const modelSelectionEnabled = config.modelSelection === true
  const providerOwnedRoute = config.providerOwnedRoute === true
  const subagentModelSelectionProjectionHandle = await ctx.sessionProjections.register(subagentModelSelectionProjectionDefinition)

  const assertSubagentProviderConfiguration = (subagentProvider: SubagentProvider): void => {
    presets.assertProvider(subagentProvider)
    if (ctx.subagents.resolveMaxDepth(config.maxDepth) !== undefined && !subagentProvider.capabilities.depthLimit) {
      throw new Error(
        `tool-subagent: provider "${subagentProvider.name}" cannot enforce maxDepth (no depthLimit capability) — `
        + 'set maxDepth: \'provider-managed\' to leave the recursion budget to the provider',
      )
    }
    if (config.agentOptions !== undefined && !subagentProvider.capabilities.agentOptions) {
      throw new Error(
        `tool-subagent: provider "${subagentProvider.name}" does not support child agentOptions`,
      )
    }
    if (modelSelectionEnabled && !subagentProvider.capabilities.agentOptions) {
      throw new Error(
        `tool-subagent: provider "${subagentProvider.name}" does not support child model selection`,
      )
    }
    if (providerOwnedRoute && !subagentProvider.capabilities.agentOptions) {
      throw new Error(
        `tool-subagent: provider "${subagentProvider.name}" does not accept per-call agent options`,
      )
    }
    if (purposeRouting && !subagentProvider.capabilities.agentOptions) {
      throw new Error(
        `tool-subagent: provider "${subagentProvider.name}" does not support purpose routing`,
      )
    }
  }

  // Validate provider-owned config outside the optional LLM binding so an
  // invalid provider always rejects its registration or this plugin's load.
  ctx.on('subagent/provider-added', (subagentProvider) => {
    if (subagentProvider.name === config.provider) assertSubagentProviderConfiguration(subagentProvider)
  })
  const initialProvider = ctx.subagents.getProvider(config.provider)
  if (initialProvider !== undefined) assertSubagentProviderConfiguration(initialProvider)

  if (config.modelDiscovery === true) registerListSubagentModels(ctx, subagentModelSelectionProjectionHandle)
  if (purposeRouting) registerListSubagentCategories(ctx)

  // Load order and HMR replacement can change provider availability while
  // this fiber remains active.
  let mounted: { subagentProvider: SubagentProvider; definition: ToolDefinition; disposeTool: () => void } | undefined
  const publishCategoryDescription = (): string => {
    const copy = readPurposeCopy(ctx)
    if (mounted !== undefined) writeCategoryDescription(mounted.definition.parameters, copy.description)
    return copy.description
  }
  if (purposeRouting) {
    // Variable providers run before tool-schema snapshots. The presentation
    // waterfall receives no tool array, and a returned `tools` field is ignored.
    // A leaking sentence throws here, before the snapshot is taken.
    ctx.systemPrompt.variable(PURPOSE_CATEGORY_VARIABLE, () => {
      publishCategoryDescription()
      return undefined
    })
    ctx.on('system-prompt/assemble', (_assembly, _context, next) => next().then((result) => {
      if (!Object.hasOwn(result.variables, PURPOSE_CATEGORY_VARIABLE)) return result
      const variables = Object.fromEntries(
        Object.entries(result.variables).filter(([key]) => key !== PURPOSE_CATEGORY_VARIABLE),
      )
      return { ...result, variables }
    }))
  }
  const mount = (subagentProvider: SubagentProvider): void => {
    assertSubagentProviderConfiguration(subagentProvider)
    const categoryDescription = purposeRouting ? publishCategoryDescription() : ''
    const wording = providerWording(subagentProvider.inheritsParentContext)
    const providerRouteDefaults = subagentProvider.agentRouteDefaults
    const selectionDescription = providerRouteDefaults !== undefined
      ? ' Supply `provider` and `model` together. Omitted values use child defaults, falling back to this backend\'s route defaults. When the effective route changes, an omitted `reasoning_effort` uses the model\'s default.'
      : ' Supply `provider` and `model` together. Omitted values use child defaults, falling back to compatible parent values. When the effective route changes, an omitted `reasoning_effort` uses the model\'s default.'
    const definition = defineTool({
      name: toolName,
      description: wording.description
        + ' This tool starts an independently managed subagent and immediately returns its id. The runtime notifies you when it finishes.'
        + (subagentProvider.prepareContinuable !== undefined
          ? ' The child reports results with `send_message`; use `send_message` to steer it while running or continue its conversation after it finishes.'
          : ' The completion notice includes its final answer. This backend does not accept follow-up messages.')
        + (modelSelectionEnabled ? selectionDescription : '')
        + (modelSelectionEnabled && subagentProvider.inheritsParentContext
          ? ' Changing the route can prevent provider-side reuse of the inherited conversation prefix.'
          : '')
        + (purposeRouting ? ` ${PURPOSE_TOOL_SENTENCE}` : ''),
      parameters: {
        cwd: {
          type: 'string',
          description: 'Initial child working directory. Relative paths use your current directory; omitted inherits it. Later directory changes in either agent are independent.',
        },
        description: {
          type: 'string',
          required: true,
          description: 'A short (3-5 word) description of the delegated task, for display.',
        },
        prompt: {
          type: 'string',
          required: true,
          description: wording.promptDescription,
        },
        ...purposeRouting ? {
          category: {
            type: 'string' as const,
            enum: [...PURPOSE_CATEGORIES],
            description: categoryDescription,
          },
        } : {},
        ...presets.choices === undefined ? {} : {
          agent_preset: {
            type: 'string' as const,
            enum: [...presets.choices],
            description: presets.description,
          },
        },
        ...(modelSelectionEnabled || providerOwnedRoute) ? {
          provider: {
            type: 'string' as const,
            description: (providerOwnedRoute
              ? 'Route in the child provider\'s own namespace (for an external CLI, its provider id). Optional and independent of model; omit to use the provider\'s configured default.'
              : 'Child LLM provider id.')
              + (purposeRouting && modelSelectionEnabled ? CATEGORY_EXCLUSIVITY_SUFFIX : ''),
          },
          model: {
            type: 'string' as const,
            description: (providerOwnedRoute
              ? 'Model id interpreted by the child provider (for an external CLI, its model name). Optional and independent of provider; omit to use the provider\'s configured default.'
              : 'Model id within that provider.')
              + (purposeRouting && modelSelectionEnabled ? CATEGORY_EXCLUSIVITY_SUFFIX : ''),
          },
          reasoning_effort: {
            type: 'string' as const,
            description: (providerOwnedRoute
              ? 'Reasoning effort for the child provider (for an external CLI, its thinking level). Omit to use configured defaults.'
              : 'Model-specific reasoning effort id.')
              + (purposeRouting && modelSelectionEnabled ? CATEGORY_EXCLUSIVITY_SUFFIX : ''),
          },
        } : {},
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', required: true, const: 'activation' },
            subagentId: { type: 'string', required: true },
            provider: { type: 'string' },
            model: { type: 'string' },
            reasoningEffort: { type: 'string' },
            ...purposeRouting ? {
              subagentIds: { type: 'array' as const, items: { type: 'string' as const } },
              notStarted: { type: 'integer' as const },
              children: {
                type: 'array' as const,
                items: {
                  type: 'object' as const,
                  additionalProperties: false,
                  properties: {
                    subagentId: { type: 'string' as const },
                    provider: { type: 'string' as const },
                    model: { type: 'string' as const },
                    reasoningEffort: { type: 'string' as const },
                  },
                },
              },
            } : {},
          },
        },
        render: (_args, value) => renderActivation(value),
        presentationMeta: (_args, value) => activationMeta(value),
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const parent = exec.agent
        if (!parent) {
          // Non-agent callers provide no parent for delegation ownership.
          throw new Error('subagent tool requires a calling agent (exec.agent was undefined)')
        }

        const routes = subagentModelSelectionPolicy(subagentModelSelectionProjectionHandle, parent.session)
        const modelSelectionPolicy = routes === undefined ? undefined : { routes }
        const category = categoryArgument(args)
        const agentPreset = presets.resolve(args as PresetSelectionRequest)
        const modelRequest = args as DelegationModelRequest
        const parentOptions = parentAgentOptionsForDelegation(parent)
        if (purposeRouting || category !== undefined) {
          const settings = ctx.get('subagentModelSelection')
          const resolution = resolveChildRoutes({
            purposeRouting,
            ...category === undefined ? {} : { category },
            modelRequest,
            table: settings === undefined ? undefined : settings.purposeRoutes(),
            parentOptions,
            configured: config.agentOptions,
            providerRouteDefaults,
            modelSelectionEnabled,
          })
          const maxDepth = ctx.subagents.resolveMaxDepth(config.maxDepth)
          return startResolvedChildren({
            runtimeCtx: ctx,
            parent,
            signal: exec.signal,
            callId: exec.callId,
            providerName: config.provider,
            subagentProvider,
            resolution,
            categoryOmitted: category === undefined,
            parentOptions,
            policy: modelSelectionPolicy,
            modelRequest,
            label: args.description,
            prompt: [{ type: 'text', text: args.prompt }],
            ...args.cwd === undefined ? {} : { cwd: args.cwd },
            ...agentPreset === undefined ? {} : { agentPreset },
            ...maxDepth !== undefined ? { maxDepth } : {},
          })
        }

        const requiresRoutePreflight = !providerOwnedRoute
          && (hasDelegationModelRequest(modelRequest) || hasConfiguredLlmSelection(config.agentOptions))
        const configuredChildAgentOptions = requiresRoutePreflight && providerRouteDefaults !== undefined
          ? { ...providerRouteDefaults, ...config.agentOptions }
          : config.agentOptions
        const requestedChildAgentOptions = providerOwnedRoute
          ? providerOwnedAgentOptions(modelRequest)
          : requestedAgentOptions(
            parentOptions,
            configuredChildAgentOptions,
            modelRequest,
            modelSelectionEnabled,
          )
        if (!providerOwnedRoute) {
          assertAllowedModelSelection(
            modelSelectionPolicy,
            parentOptions,
            requestedChildAgentOptions,
            modelRequest,
          )
        }
        if (requiresRoutePreflight) {
          const llm = ctx.get('llm')
          if (llm === undefined) {
            throw new Error('cannot resolve the selected child LLM route because the `llm` service is unavailable')
          }
          await preflightChildLlmRoute(
            llm,
            parentOptions,
            requestedChildAgentOptions,
            exec.signal,
            providerRouteDefaults === undefined,
          )
          if (ctx.subagents.getProvider(config.provider) !== subagentProvider) {
            throw new Error(`subagent provider "${config.provider}" changed while resolving the child LLM route; retry the delegation`)
          }
        }
        exec.signal.throwIfAborted()
        const maxDepth = ctx.subagents.resolveMaxDepth(config.maxDepth)
        const request = {
          ...args.cwd === undefined ? {} : { cwd: args.cwd },
          prompt: [{ type: 'text', text: args.prompt }] as ContentBlock[],
          parent,
          ...agentPreset === undefined ? {} : { agentPreset },
          ...requestedChildAgentOptions !== undefined ? { agentOptions: requestedChildAgentOptions } : {},
          ...maxDepth !== undefined ? { maxDepth } : {},
        }

        const started = await ctx.subagents.startActivation({
          provider: config.provider,
          label: args.description,
          request,
          signal: exec.signal,
          delivery: 'parent',
        })
        return { kind: 'activation' as const, subagentId: started.childId, ...usedRoute(parent, requestedChildAgentOptions) }
      },
    })
    const disposeTool = ctx.effect(() => {
      const unregister = ctx.tools.register(definition)
      delegationTools.add(definition)
      if (purposeRouting) purposeRoutingTools.set(definition, true)
      return () => {
        purposeRoutingTools.delete(definition)
        delegationTools.delete(definition)
        unregister()
      }
    })
    // oxlint-disable-next-line typescript/no-misused-promises -- Tool and guidance disposal are synchronous.
    mounted = { subagentProvider, definition, disposeTool }
  }

  // Register listeners before checking presence so no synchronous change is missed.
  ctx.on('subagent/provider-added', (subagentProvider) => {
    if (subagentProvider.name === config.provider && mounted === undefined) mount(subagentProvider)
  })
  ctx.on('subagent/provider-removed', (name) => {
    if (name !== config.provider || mounted === undefined) return
    mounted.disposeTool()
    mounted = undefined
  })
  const present = ctx.subagents.getProvider(config.provider)
  if (present !== undefined) {
    mount(present)
  } else {
    // A backend fiber may activate later; a misspelled provider remains visible in this log.
    ctx.logger.info(`subagent provider "${config.provider}" not registered yet; the "${config.toolName ?? 'subagent'}" tool will register when it appears`)
  }
  ctx.systemPrompt.section({
    name: `tool:${toolName}`,
    order: ctx.systemPrompt.getSectionOrder('TOOL_SUBAGENT'),
    text: (context) => {
      if (mounted === undefined) return ''
      const visibleDefinitions = [...delegationTools]
        .filter(tool => ctx.tools.get(tool.name, context.scope) === tool)
      const visible = visibleDefinitions.map(tool => tool.name).sort()
      if (visible[0] !== toolName) return ''
      const names = visible.map(name => `\`${name}\``).join(' or ')
      const lead = `Start independent delegations with ${names} together in one assistant message and continue useful work while they run. When only waiting for their results remains, end your turn instead of sleeping or polling; the next result starts a new turn.`
      if (!visibleDefinitions.some(tool => purposeRoutingTools.has(tool))) return lead
      const copy = readPurposeCopy(ctx)
      return `${lead}\n\n${splittingAddition(copy.guidance, copy.table)}`
    },
  })
  ctx.systemPrompt.context({
    name: `tool:${toolName}:depth`,
    order: ctx.systemPrompt.getContextOrder('SUBAGENT_DELEGATION'),
    text: (context) => {
      if (context.agent === undefined || mounted === undefined
        || ctx.tools.get(toolName, context.scope) !== mounted.definition) return ''
      const maxDepth = ctx.subagents.resolveMaxDepth(config.maxDepth)
      if (maxDepth === undefined) return ''
      const depth = delegationDepthOf(context.agent)
      if (depth < maxDepth) return ''
      return `Delegation depth for \`${toolName}\`: current ${depth}, maximum ${maxDepth}, remaining levels 0.`
        + ` Do not call \`${toolName}\` at this depth; carry out the work directly.`
    },
  })
}
