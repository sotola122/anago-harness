/** Host-owned opt-in setting for model-selectable subagent delegation. */
import type { Volatile } from '@deepseek-ai/cordis'

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  AllowedModelRouteSchema,
  assertAllowedModelRoutes,
  type AllowedModelRoute,
} from './model-selection.ts'
import {
  PurposeRouteTableSchema,
  purposeTableFromStored,
} from './purpose-routing.ts'
import type { PurposeRouteTable, StoredPurposeRouteTable } from './purpose-routing.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** User preference sampled when a new Session receives delegation tools. */
    subagentModelSelection: SubagentModelSelectionConfig
  }
}

/** Stored user preference; the shipped composition defaults it off. */
export interface SubagentModelSelectionSettings {
  /** Whether newly composed top-level Sessions receive model selection. */
  enabled: boolean
  /** Exact child LLM routes offered to newly composed top-level Sessions. */
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
}

/** Singleton settings owner read when delegation tools are composed for a Session. */
export class SubagentModelSelectionConfig extends Service {
  static Config = z.object({
    enabled: z.boolean().default(false).volatile(),
    allowedModels: z.array(AllowedModelRouteSchema).default([]).volatile(),
    purposeRoutes: z.union([PurposeRouteTableSchema, z.const(null)]).default(null).volatile(),
  })

  constructor(ctx: Context, private config: Config) {
    super(ctx, 'subagentModelSelection')
    const table = readPurposeRoutes(this.config)
    if (table !== null) purposeTableFromStored(table)
  }

  /**
   * Read a detached selection preference for the next eligible Session composition.
   * @returns the enabled state and exact allowed routes.
   */
  current(): SubagentModelSelectionSettings {
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

}

/**
 * Read the live table. A direct `plugin()` call can omit the field; that is the null default.
 * @param config - settings plugin config.
 * @returns the current table, or null when none is configured.
 */
function readPurposeRoutes(config: Config): StoredPurposeRouteTable | null {
  const field = config.purposeRoutes
  if (field === undefined) return null
  return field.get() ?? null
}

export type { PurposeCategory, PurposeRoute, PurposeRouteSlot, PurposeRouteTable } from './purpose-routing.ts'
export { PURPOSE_CATEGORIES, PURPOSE_ROUTE_SLOTS, assertPurposeRouteTable } from './purpose-routing.ts'

export const name = 'subagent-model-selection-settings'
export default SubagentModelSelectionConfig
