/** Host-owned opt-in setting for model-selectable subagent delegation. */
import type { Volatile } from '@deepseek-ai/cordis'

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent'
import {
  subagentModelSelectionPolicy,
  subagentModelSelectionProjectionDefinition,
} from './model-selection-state.ts'
import {
  AllowedModelRouteSchema,
  assertAllowedModelRoutes,
  type AllowedModelRoute,
} from './model-selection.ts'
import {
  assertPurposeGuidance,
  PurposeGuidanceSchema,
  PurposeRouteTableSchema,
  purposeTableFromStored,
} from './purpose-routing.ts'
import type { PurposeGuidance, PurposeRouteTable, StoredPurposeRouteTable } from './purpose-routing.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** User preference sampled during Agent creation. */
    subagentModelSelection: SubagentModelSelectionConfig
  }
}

/** Stored user preference; the shipped composition defaults it off. */
export interface SubagentModelSelectionSettings {
  /** Whether new top-level Sessions receive model selection. */
  enabled: boolean
  /** Exact child LLM routes offered to new top-level Sessions. */
  allowedModels: AllowedModelRoute[]
}

/** Optional deployment base for the preference. */
export interface Config {
  /** Initial enabled state inherited when the user document does not override it. */
  enabled: Volatile<boolean>
  /** Initial route list inherited when the user document does not override it. */
  allowedModels: Volatile<AllowedModelRoute[]>
  /**
   * Purpose routing table read at every delegation; null when this deployment has none.
   * Efforts are stored as strings because a branded id does not survive a volatile snapshot.
   */
  purposeRoutes: Volatile<StoredPurposeRouteTable | null>
  /**
   * Purpose sentences read when a model-facing description is composed.
   * Null means the built-in text. A non-null value requires every sentence.
   */
  purposeGuidance: Volatile<PurposeGuidance | null>
}

/** Host settings owner that records Session authorization before the first model request. */
export class SubagentModelSelectionConfig extends Service {
  static inject = ['sessionProjections', 'sessions']

  static Config = z.object({
    enabled: z.boolean().default(false).volatile(),
    allowedModels: z.array(AllowedModelRouteSchema).default([]).volatile(),
    purposeRoutes: z.union([PurposeRouteTableSchema, z.const(null)]).default(null).volatile(),
    purposeGuidance: z.union([PurposeGuidanceSchema, z.const(null)]).default(null).volatile(),
  })

  constructor(ctx: Context, private config: Config) {
    super(ctx, 'subagentModelSelection')
    const table = readPurposeRoutes(this.config)
    if (table !== null) purposeTableFromStored(table)
    const guidance = readPurposeGuidance(this.config)
    if (guidance !== null) assertPurposeGuidance(guidance)
  }

  protected async [Service.init](): Promise<void> {
    const ctx = this.ctx
    const policyReady = ctx.sessionProjections.register(subagentModelSelectionProjectionDefinition)
    ctx.on('agent/created', async ({ agent }) => {
      const policy = await policyReady
      ctx.fiber.assertActive()
      const target = agent.session
      if (subagentModelSelectionPolicy(policy, target) !== undefined) return
      let allowedModels: AllowedModelRoute[] | undefined
      const parentId = target.header.origin === 'subagent' ? target.header.parentSession : undefined
      if (parentId !== undefined) {
        const parent = ctx.sessions.get(parentId)
        if (parent !== undefined) allowedModels = subagentModelSelectionPolicy(policy, parent)
      } else if (target.firstLiveSeq === 0
        // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
        && target.eventAt(SessionSeq(0))?.type !== 'session/end-seed') {
        const current = this.current()
        allowedModels = current.enabled ? current.allowedModels : undefined
      }
      if (allowedModels !== undefined) target.append('subagent/model-selection-policy', { allowedModels })
    })
    await policyReady
  }

  /**
   * Read a detached selection preference for the next fresh top-level Session.
   * @returns the enabled state and exact allowed routes.
   */
  private current(): SubagentModelSelectionSettings {
    const enabled = this.config.enabled.get()
    const allowedModels = this.config.allowedModels.get()
    assertAllowedModelRoutes(allowedModels)
    if (enabled && allowedModels.length === 0) {
      throw new Error('enabled subagent model selection requires at least one allowed model')
    }
    return { enabled, allowedModels: allowedModels.map(route => ({ ...route })) }
  }

  /**
   * Read a detached copy of the current purpose routing table.
   * @returns the validated table, or null when none is configured.
   * @throws when a configured table is empty, has an extra non-review route, or repeats a triple.
   */
  purposeRoutes(): PurposeRouteTable | null {
    const table = readPurposeRoutes(this.config)
    if (table === null) return null
    return purposeTableFromStored(table)
  }

  /**
   * Read the current purpose sentences.
   * @returns a detached copy, or null when the deployment uses the built-in text.
   * @throws when a stored sentence is missing or longer than its cap.
   */
  purposeGuidance(): PurposeGuidance | null {
    const guidance = readPurposeGuidance(this.config)
    if (guidance === null) return null
    assertPurposeGuidance(guidance)
    return {
      light: guidance.light,
      medium: guidance.medium,
      deep: guidance.deep,
      review: guidance.review,
      writing: guidance.writing,
      omit: guidance.omit,
      splitting: guidance.splitting,
    }
  }

}

/**
 * Read the live table. An omitted value is the null default.
 * @param config - settings plugin config.
 * @returns the current table, or null when none is configured.
 */
function readPurposeRoutes(config: Config): StoredPurposeRouteTable | null {
  return config.purposeRoutes.get() ?? null
}

/**
 * Read the live guidance. An omitted value is the null default.
 * @param config - settings plugin config.
 * @returns the current sentences, or null when the deployment uses built-in text.
 */
function readPurposeGuidance(config: Config): PurposeGuidance | null {
  return config.purposeGuidance.get() ?? null
}

export type { PurposeCategory, PurposeGuidance, PurposeRoute, PurposeRouteSlot, PurposeRouteTable } from './purpose-routing.ts'
export { PURPOSE_CATEGORIES, PURPOSE_ROUTE_SLOTS, assertPurposeRouteTable } from './purpose-routing.ts'

export const name = 'subagent-model-selection-settings'
export default SubagentModelSelectionConfig
