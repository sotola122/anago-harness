/** Shared presentation and actions for the Host-owned Subagent settings sections. */

import type { SettingsFormShell } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SubagentLimitsCardFace, SubagentLimitsCardState } from './subagent-limits-card-controller.ts'
import type {
  SubagentModelSelectionCardFace, SubagentModelSelectionCardState,
} from './subagent-model-selection-card-controller.ts'
import type {
  SubagentPurposeRoutesCardFace, SubagentPurposeRoutesCardState,
} from './subagent-purpose-routes-card-controller.ts'

/** Existing form sources and the actions exposed by one Subagent card. */
export interface SubagentCardFace {
  hooks: SubagentLimitsCardFace['hooks']
    & SubagentModelSelectionCardFace['hooks']
    & SubagentPurposeRoutesCardFace['hooks']
  editLimit: SubagentLimitsCardFace['edit']
  resetLimit: SubagentLimitsCardFace['resetField']
  toggleEnabled: SubagentModelSelectionCardFace['toggleEnabled']
  toggleModel: SubagentModelSelectionCardFace['toggleModel']
  retryCatalog: SubagentModelSelectionCardFace['retryCatalog']
  editPurposeRoute: SubagentPurposeRoutesCardFace['editRoute']
  addReviewer: SubagentPurposeRoutesCardFace['addReviewer']
  removeReviewer: SubagentPurposeRoutesCardFace['removeReviewer']
  moveReviewer: SubagentPurposeRoutesCardFace['moveReviewer']
  retryPurposeCatalog: SubagentPurposeRoutesCardFace['retryCatalog']
  /** Save valid drafts through their owning controllers. */
  save: () => void
  /** Discard every draft without changing persisted settings. */
  discard: () => void
}

/**
 * Derive the shared card state without duplicating any form's subscriptions.
 * @param limits - Current delegation-limit form.
 * @param models - Current model-authorization form.
 * @param purpose - Current purpose-routing form. It shares the model-selection namespace.
 * @returns Availability and settlement across the sections this Host serves.
 */
export function subagentCardShell(
  limits: SubagentLimitsCardState,
  models: SubagentModelSelectionCardState,
  purpose: SubagentPurposeRoutesCardState,
): SettingsFormShell {
  const sections = [limits, models, purpose].filter(section => section.available)
  return {
    available: sections.length > 0,
    writable: sections.every(section => section.writable),
    dirty: sections.some(section => section.dirty),
    invalid: sections.some(section => section.invalid)
      || (models.available && models.dirty && models.conflicted)
      || (purpose.available && purpose.dirty && purpose.conflicted),
    saving: sections.some(section => section.saving),
    failed: sections.some(section => section.failed),
  }
}

/**
 * Compose one card from the existing forms. Purpose routes share the model-selection
 * namespace, so that write waits for the other field write on the same revision.
 * @param limits - Limit form source and actions.
 * @param models - Model form source and actions.
 * @param purpose - Purpose-route form source and actions.
 * @returns Framework-bound sources and shared save/discard actions.
 */
export function subagentCardFace(
  limits: SubagentLimitsCardFace,
  models: SubagentModelSelectionCardFace,
  purpose: SubagentPurposeRoutesCardFace,
): SubagentCardFace {
  return {
    hooks: { ...limits.hooks, ...models.hooks, ...purpose.hooks },
    editLimit: limits.edit,
    resetLimit: limits.resetField,
    toggleEnabled: models.toggleEnabled,
    toggleModel: models.toggleModel,
    retryCatalog: models.retryCatalog,
    editPurposeRoute: purpose.editRoute,
    addReviewer: purpose.addReviewer,
    removeReviewer: purpose.removeReviewer,
    moveReviewer: purpose.moveReviewer,
    retryPurposeCatalog: purpose.retryCatalog,
    save: () => {
      const limitState = limits.hooks.subagentLimitsCard.getSnapshot()
      const modelState = models.hooks.subagentModelSelectionCard.getSnapshot()
      const purposeState = purpose.hooks.subagentPurposeRoutesCard.getSnapshot()
      const state = subagentCardShell(limitState, modelState, purposeState)
      if (!state.available || !state.writable || !state.dirty || state.invalid || state.saving) return
      const modelDirty = modelState.available && modelState.dirty
      const purposeDirty = purposeState.available && purposeState.dirty
      if (modelDirty && purposeDirty) void models.save().then(() => purpose.save())
      else {
        if (modelDirty) void models.save()
        if (purposeDirty) void purpose.save()
      }
      if (limitState.available && limitState.dirty) limits.save()
    },
    discard: () => {
      if (subagentCardShell(
        limits.hooks.subagentLimitsCard.getSnapshot(),
        models.hooks.subagentModelSelectionCard.getSnapshot(),
        purpose.hooks.subagentPurposeRoutesCard.getSnapshot(),
      ).saving) return
      limits.discard()
      models.discard()
      purpose.discard()
    },
  }
}
