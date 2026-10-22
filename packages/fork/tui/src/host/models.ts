/**
 * DSH model catalog access for the terminal UI's model picker.
 *
 * The picker lists what the Host LLM service advertises, marks the route the
 * Agent currently uses, and resolves one chosen route through the adapter so a
 * provider-defaulted reasoning effort is normalized before it is installed.
 * @module @anago-harness/tui/host/models
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type { LlmModelInfo } from '@deepseek-ai/dsh-llm'
import type { ModelOption, ModelRoute } from '../app/pickers.ts'

/**
 * List the registered provider/model routes.
 *
 * A provider whose adapter publishes no catalog is omitted rather than failing
 * the picker; the current route is always present so the dialog can show and
 * keep it even when it is outside every catalog. Without the `llm` service the
 * picker still offers the current route or the configured default, so a profile
 * that only mounts `agentDefaultModel` can inspect its route.
 * @param ctx - plugin context carrying the optional `llm` and `agentDefaultModel` services.
 * @param current - route the Agent currently uses, when one is open.
 * @returns selectable routes in provider order.
 * @throws when neither a current route nor the default-model service names one.
 */
export async function listModelOptions(
  ctx: Context,
  current: ModelRoute | undefined,
): Promise<readonly ModelOption[]> {
  const llm = ctx.get('llm')
  if (llm === undefined) {
    const fallback = current ?? ctx.get('agentDefaultModel')?.currentSelection()
    if (fallback === undefined) {
      throw new Error('the model picker requires the llm service or a configured agentDefaultModel provider and model')
    }
    return [{ provider: fallback.provider, model: fallback.model, label: fallback.model, current: true }]
  }
  const options: ModelOption[] = []
  for (const provider of llm.listProviders()) {
    let models: readonly LlmModelInfo[]
    try {
      models = await llm.listModels(provider.id)
    } catch (_catalogUnavailable) {
      // Model catalogs are advisory; a provider without one still routes requests.
      continue
    }
    for (const model of models) {
      options.push({
        provider: provider.id,
        model: model.id,
        label: model.name,
        ...model.description === undefined ? {} : { description: model.description },
        current: current?.provider === provider.id && current.model === model.id,
      })
    }
  }
  const known = options.some(option => option.current)
  if (current !== undefined && !known) {
    options.unshift({
      provider: current.provider,
      model: current.model,
      label: current.model,
      current: true,
    })
  }
  return options
}

/**
 * Resolve a chosen route through the adapter that owns it.
 *
 * Resolution validates the route and folds in the adapter's default reasoning
 * effort, so the installed selection matches what the next request would use.
 * @param ctx - plugin context carrying the optional `llm` service.
 * @param route - provider and model chosen in the picker.
 * @returns the normalized route.
 */
export async function resolveModelRoute(ctx: Context, route: ModelRoute): Promise<ModelRoute> {
  const llm = ctx.get('llm')
  if (llm === undefined) return route
  const resolved = await llm.resolveCallConfig({ provider: route.provider, model: route.model })
  return { provider: resolved.provider, model: resolved.model }
}
