/**
 * Staged editor for the purpose routing table on the model-selection settings form.
 * A null table means this deployment has no routing; an empty slot is invalid
 * and cannot be saved. `review` is the only slot that holds several routes.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ModelProviderGroup } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsFormScope, SettingsFormShell } from '@deepseek-ai/dsh-client-ui-primitives'
import { beginRevisionSave, loadSessionModelCatalog } from './settings-catalog.tsx'

/**
 * Table rows in settings UI order. Matches the Host slot list; this package
 * does not import the Host module.
 */
export const PURPOSE_ROUTE_SLOTS = ['light', 'medium', 'deep', 'review', 'writing', 'default'] as const

/** One required purpose-routing row, including the omission slot. */
export type PurposeRouteSlot = typeof PURPOSE_ROUTE_SLOTS[number]

/** One field of a route picker. */
export type PurposeRouteField = 'provider' | 'model' | 'effort'

/** Direction of one reviewer reorder. */
export type PurposeRouteMove = 'earlier' | 'later'

/** One stored child route. Effort stays a string, as the volatile snapshot stores it. */
export interface PurposeRouteDraft {
  provider: string
  model: string
  reasoningEffort: string
}

/** Complete table. A missing slot is an empty list and cannot be saved. */
export type PurposeRouteTableDraft = { [S in PurposeRouteSlot]: PurposeRouteDraft[] }

/** Sentence fields, in settings UI order. `default` edits `omit`. */
export const GUIDANCE_SLOTS = ['light', 'medium', 'deep', 'review', 'writing', 'omit', 'splitting'] as const

/** One editable guidance sentence. */
export type GuidanceSlot = typeof GUIDANCE_SLOTS[number]

/** Inclusive cap for a category or omission sentence. Matches the Host schema. */
export const GUIDANCE_SENTENCE_MAX = 200

/** Inclusive cap for the optional splitting paragraph. An empty string is allowed. */
export const GUIDANCE_SPLITTING_MAX = 400

/**
 * Sentences shown when `purposeGuidance` is null.
 * Category clauses match the Host's pinned purpose text. The client does not import that module.
 */
export const BUILTIN_GUIDANCE: { readonly [S in GuidanceSlot]: string } = {
  light: 'quick lookups, small mechanical edits, short summaries',
  medium: 'ordinary implementation or investigation',
  deep: 'hard debugging, design, or long multi-step reasoning',
  review: 'independent review of a change, plan, or document; may start several reviewers in parallel, each reporting separately',
  writing: 'documentation, PR or issue text, translation, user-facing prose',
  omit: 'Only when the task fits no named purpose.',
  splitting: '',
}

/** One complete guidance value. Null means the built-in sentences. */
export interface PurposeGuidanceDraft {
  light: string
  medium: string
  deep: string
  review: string
  writing: string
  omit: string
  splitting: string
}

/** Why one sentence cannot be saved. */
export type GuidanceIssue = 'empty' | 'long' | 'identifier'

/** One sentence as the card renders it. */
export interface GuidanceFieldState {
  slot: GuidanceSlot
  text: string
  issue?: GuidanceIssue
  /** Route identifier found in the sentence, when `issue` is `identifier`. */
  identifier?: string
}

/** Settings fields this editor reads and writes. Other fields on the form are ignored. */
export interface PurposeRoutesSettings {
  purposeRoutes?: PurposeRouteTableDraft | null
  purposeGuidance?: PurposeGuidanceDraft | null
}

/** One catalogue choice shown in a route picker. */
export interface PurposeRouteOption {
  id: string
  name: string
}

/** One staged route joined with the catalogue choices that can fill it. */
export interface PurposeRouteEditorState extends PurposeRouteDraft {
  /** Stable identity for the row. Not written to settings. */
  id: string
  /** Whether the current catalogue advertises this provider and model. */
  available: boolean
  /** Whether provider, model, or effort is empty. */
  missing: boolean
  /** Whether the selected catalogue model does not advertise this effort. */
  effortUnsupported: boolean
  providers: readonly PurposeRouteOption[]
  models: readonly PurposeRouteOption[]
  efforts: readonly PurposeRouteOption[]
}

/** One purpose row as the card renders it. */
export interface PurposeRouteRowState {
  slot: PurposeRouteSlot
  /** Whether this slot may hold several routes. */
  fanOut: boolean
  routes: readonly PurposeRouteEditorState[]
  /** Whether two complete routes in this slot share a provider, model, and effort. */
  duplicate: boolean
  /** Whether a non-review slot holds more than one route. */
  extra: boolean
  /** Whether the slot has no route. */
  empty: boolean
  /** Model-facing sentence for this row. The default row edits `omit`. */
  guidance: GuidanceFieldState
}

/** State rendered by the purpose-routes section. */
export interface SubagentPurposeRoutesCardState extends SettingsFormShell {
  /** Whether the Host returned a table. Null is routing off, not an empty editor. */
  configured: boolean
  rows: readonly PurposeRouteRowState[]
  catalogStatus: 'idle' | 'loading' | 'ready' | 'error'
  catalogPartial: boolean
  /** Whether a newer Host revision invalidated the current draft. */
  conflicted: boolean
  /** Optional splitting paragraph shown under the rows. */
  splitting: GuidanceFieldState
  /** Whether the displayed sentences are the built-in text. */
  guidanceBuiltin: boolean
}

/** Registration-side face for the purpose-routes section. */
export interface SubagentPurposeRoutesCardFace {
  hooks: {
    /** Card snapshot bound by the renderer as useSubagentPurposeRoutesCard. */
    subagentPurposeRoutesCard: SnapshotStore<SubagentPurposeRoutesCardState>
  }
  /** Stage one field of one route. Changing provider or model fills the dependent fields. */
  editRoute: (slot: PurposeRouteSlot, index: number, field: PurposeRouteField, value: string) => void
  /** Append one blank reviewer. No-op unless a table is configured. */
  addReviewer: () => void
  /** Remove one reviewer. The slot cannot drop below one route. */
  removeReviewer: (index: number) => void
  /** Move one reviewer earlier or later in the slot. */
  moveReviewer: (index: number, direction: PurposeRouteMove) => void
  /** Retry the adapter directory. */
  retryCatalog: () => void
  /** Stage one guidance sentence. The default row writes `omit`. */
  editGuidance: (slot: GuidanceSlot, value: string) => void
  /** Stage `purposeGuidance: null`, restoring the built-in sentences. */
  resetGuidance: () => void
  /** Persist changed routes and sentences as separate revision-fenced ops. */
  save: () => Promise<void>
  /** Drop the staged table and sentences. */
  discard: () => void
}

const FAN_OUT: ReadonlySet<PurposeRouteSlot> = new Set(['review'])

interface DraftRoute extends PurposeRouteDraft {
  id: string
}

type DraftTable = { [S in PurposeRouteSlot]: DraftRoute[] }

interface CatalogModel {
  efforts: readonly PurposeRouteOption[]
  defaultEffort?: string
}

/**
 * Whether two tables carry the same routes in the same order.
 * @param left - one table, or null when none is configured.
 * @param right - the other table.
 * @returns whether every slot matches.
 */
export function samePurposeRouteTable(
  left: PurposeRouteTableDraft | null,
  right: PurposeRouteTableDraft | null,
): boolean {
  if (left === null || right === null) return left === right
  return PURPOSE_ROUTE_SLOTS.every((slot) => {
    const a = left[slot]
    const b = right[slot]
    return a.length === b.length && a.every((route, index) => {
      const other = b[index]
      if (other === undefined) return false
      return route.provider === other.provider
        && route.model === other.model
        && route.reasoningEffort === other.reasoningEffort
    })
  })
}

/**
 * Read a table from a settings value. Null and a missing field are routing off.
 * A present object is a table even when a slot is empty or malformed.
 * @param raw - the `purposeRoutes` field.
 * @returns the table, or null when routing is off.
 */
export function purposeRouteTableFromValue(raw: unknown): PurposeRouteTableDraft | null {
  if (raw == null) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  return {
    light: normalizeRoutes(record.light),
    medium: normalizeRoutes(record.medium),
    deep: normalizeRoutes(record.deep),
    review: normalizeRoutes(record.review),
    writing: normalizeRoutes(record.writing),
    default: normalizeRoutes(record.default),
  }
}

/**
 * Whether two guidance values carry the same sentences. Null matches null.
 * @param left - one value, or null for built-in text.
 * @param right - the other value.
 * @returns whether every sentence matches.
 */
export function samePurposeGuidance(
  left: PurposeGuidanceDraft | null,
  right: PurposeGuidanceDraft | null,
): boolean {
  if (left === null || right === null) return left === right
  return GUIDANCE_SLOTS.every(slot => left[slot] === right[slot])
}

/**
 * Read guidance from a settings value. Null and a missing field are built-in text.
 * A present object is guidance even when a sentence is empty or not a string.
 * @param raw - the `purposeGuidance` field.
 * @returns the sentences, or null when the deployment uses built-in text.
 */
export function purposeGuidanceFromValue(raw: unknown): PurposeGuidanceDraft | null {
  if (raw == null) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  return {
    light: sentenceOf(record.light),
    medium: sentenceOf(record.medium),
    deep: sentenceOf(record.deep),
    review: sentenceOf(record.review),
    writing: sentenceOf(record.writing),
    omit: sentenceOf(record.omit),
    splitting: sentenceOf(record.splitting),
  }
}

function sentenceOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function cloneGuidance(value: PurposeGuidanceDraft): PurposeGuidanceDraft {
  return { ...value }
}

/**
 * Find the first reason a sentence cannot be saved.
 * Empty is allowed only for `splitting`. Identifier matching is a substring of a route id.
 * @param slot - sentence being checked.
 * @param text - the staged sentence.
 * @param identifiers - provider and model ids from the table the save will leave in place.
 * @returns the issue, or undefined when the sentence can be saved.
 */
export function guidanceIssue(
  slot: GuidanceSlot,
  text: string,
  identifiers: readonly string[],
): { issue: GuidanceIssue; identifier?: string } | undefined {
  const max = slot === 'splitting' ? GUIDANCE_SPLITTING_MAX : GUIDANCE_SENTENCE_MAX
  if (slot !== 'splitting' && text.length === 0) return { issue: 'empty' }
  if (text.length > max) return { issue: 'long' }
  const identifier = identifiers.find(id => id !== '' && text.includes(id))
  if (identifier !== undefined) return { issue: 'identifier', identifier }
  return undefined
}

function routeIdentifiers(table: PurposeRouteTableDraft | null): string[] {
  if (table === null) return []
  const identifiers: string[] = []
  for (const slot of PURPOSE_ROUTE_SLOTS) {
    for (const route of table[slot]) {
      if (route.provider !== '' && !identifiers.includes(route.provider)) identifiers.push(route.provider)
      if (route.model !== '' && !identifiers.includes(route.model)) identifiers.push(route.model)
    }
  }
  return identifiers
}

function normalizeRoutes(value: unknown): PurposeRouteDraft[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (item === null || typeof item !== 'object') return []
    const route = item as Record<string, unknown>
    if (typeof route.provider !== 'string' || typeof route.model !== 'string' || typeof route.reasoningEffort !== 'string') {
      return []
    }
    return [{ provider: route.provider, model: route.model, reasoningEffort: route.reasoningEffort }]
  })
}

function emptyTable(): PurposeRouteTableDraft {
  return { light: [], medium: [], deep: [], review: [], writing: [], default: [] }
}

function cloneTable(table: PurposeRouteTableDraft): PurposeRouteTableDraft {
  return {
    light: table.light.map(route => ({ ...route })),
    medium: table.medium.map(route => ({ ...route })),
    deep: table.deep.map(route => ({ ...route })),
    review: table.review.map(route => ({ ...route })),
    writing: table.writing.map(route => ({ ...route })),
    default: table.default.map(route => ({ ...route })),
  }
}

function strip(table: DraftTable): PurposeRouteTableDraft {
  const stored = emptyTable()
  for (const slot of PURPOSE_ROUTE_SLOTS) {
    stored[slot] = table[slot].map(route => ({
      provider: route.provider,
      model: route.model,
      reasoningEffort: route.reasoningEffort,
    }))
  }
  return stored
}

function routeKey(route: PurposeRouteDraft): string {
  return `${route.provider}\0${route.model}\0${route.reasoningEffort}`
}

function isComplete(route: PurposeRouteDraft): boolean {
  return route.provider !== '' && route.model !== '' && route.reasoningEffort !== ''
}

function hasDuplicate(routes: readonly PurposeRouteDraft[]): boolean {
  const seen = new Set<string>()
  for (const route of routes) {
    if (!isComplete(route)) continue
    const key = routeKey(route)
    if (seen.has(key)) return true
    seen.add(key)
  }
  return false
}

/** Bridges the purpose-routing field and the live adapter directory onto a staged section. */
export class SubagentPurposeRoutesCardController {
  private catalogGroups: readonly ModelProviderGroup[] = []
  private catalogPartial = false
  private catalogStatus: SubagentPurposeRoutesCardState['catalogStatus'] = 'idle'
  private draft: DraftTable | undefined
  private baseline: PurposeRouteTableDraft = emptyTable()
  private guidanceDraft: PurposeGuidanceDraft | null | undefined
  private guidanceBaseline: PurposeGuidanceDraft | null = null
  private draftRevision: number | undefined
  private saving = false
  private failed = false
  private conflicted = false
  private disposed = false
  private saveGeneration = 0
  private catalogGeneration = 0
  private nextRouteId = 1
  private readonly viewIds = new Map<string, string>()
  private readonly placeholderIds = new Map<PurposeRouteSlot, string>()
  private readonly store: SnapshotStore<SubagentPurposeRoutesCardState>
  private readonly unsubscribe: () => void

  /**
   * @param scope - bound `subagent-model-selection-settings` form. Only `purposeRoutes` is read or written.
   * @param ctx - the card plugin's context, whose `remote.session` namespace answers the Host model catalog.
   */
  constructor(
    private readonly scope: SettingsFormScope<PurposeRoutesSettings>,
    private readonly ctx: ClientContext,
  ) {
    this.store = createSnapshotStore(this.projection())
    this.unsubscribe = scope.subscribe(() => {
      this.noteRevision()
      if (this.needsCatalog() && this.catalogStatus === 'idle') void this.loadCatalog()
      this.publish()
    })
    if (this.needsCatalog() && this.catalogStatus === 'idle') void this.loadCatalog()
  }

  /** Stop observing settings and suppress late directory/write settlements. */
  dispose(): void {
    this.disposed = true
    this.saveGeneration += 1
    this.catalogGeneration += 1
    this.unsubscribe()
  }

  /**
   * Build the renderer face for this section.
   * @returns The snapshot and staged actions injected into the renderer.
   */
  inject(): SubagentPurposeRoutesCardFace {
    return {
      hooks: { subagentPurposeRoutesCard: this.store },
      editRoute: (slot, index, field, value) => { this.editRoute(slot, index, field, value) },
      addReviewer: () => { this.addReviewer() },
      removeReviewer: (index) => { this.removeReviewer(index) },
      moveReviewer: (index, direction) => { this.moveReviewer(index, direction) },
      retryCatalog: () => { void this.loadCatalog() },
      editGuidance: (slot, value) => { this.editGuidance(slot, value) },
      resetGuidance: () => { this.resetGuidance() },
      save: () => this.save(),
      discard: () => { this.discard() },
    }
  }

  /** Invalidate and reload model choices after a Host model input changes. */
  refreshCatalog(): void {
    if (this.disposed) return
    this.catalogGeneration += 1
    this.catalogStatus = 'idle'
    this.catalogPartial = false
    if (this.needsCatalog()) void this.loadCatalog()
    else this.publish()
  }

  /** Drop Host-specific choices and drafts, then reload after reconnecting. */
  resetConnection(): void {
    if (this.disposed) return
    this.saveGeneration += 1
    this.saving = false
    this.clearDraft()
    this.catalogGroups = []
    this.refreshCatalog()
  }

  private needsCatalog(): boolean {
    return this.currentTable() !== null || this.draft !== undefined
  }

  private currentTable(): PurposeRouteTableDraft | null {
    return purposeRouteTableFromValue(this.scope.getSnapshot().value?.purposeRoutes)
  }

  private desiredTable(): PurposeRouteTableDraft | null {
    return this.draft === undefined ? this.currentTable() : strip(this.draft)
  }

  private currentGuidance(): PurposeGuidanceDraft | null {
    return purposeGuidanceFromValue(this.scope.getSnapshot().value?.purposeGuidance)
  }

  private desiredGuidance(): PurposeGuidanceDraft | null {
    return this.guidanceDraft === undefined ? this.currentGuidance() : this.guidanceDraft
  }

  private displayedGuidance(): PurposeGuidanceDraft {
    return this.desiredGuidance() ?? { ...BUILTIN_GUIDANCE }
  }

  private dirty(): boolean {
    return !samePurposeRouteTable(this.currentTable(), this.desiredTable())
      || !samePurposeGuidance(this.currentGuidance(), this.desiredGuidance())
  }

  private mint(): string {
    const id = `route-${this.nextRouteId}`
    this.nextRouteId += 1
    return id
  }

  private idFor(slot: PurposeRouteSlot, index: number, route: PurposeRouteDraft): string {
    const key = `${slot}\0${index}\0${route.provider}\0${route.model}\0${route.reasoningEffort}`
    const existing = this.viewIds.get(key)
    if (existing !== undefined) return existing
    const id = this.mint()
    this.viewIds.set(key, id)
    return id
  }

  private canEdit(): boolean {
    const snapshot = this.scope.getSnapshot()
    return !this.disposed && snapshot.status === 'ready' && snapshot.writable && !this.saving && this.currentTable() !== null
  }

  private beginDraft(): DraftTable {
    if (this.draft !== undefined) return this.draft
    // canEdit already required a table in this turn.
    const stored = this.currentTable() as PurposeRouteTableDraft
    const draft = emptyTable() as DraftTable
    for (const slot of PURPOSE_ROUTE_SLOTS) {
      draft[slot] = stored[slot].map((route, index) => ({ ...route, id: this.idFor(slot, index, route) }))
    }
    this.draft = draft
    this.beginTracking()
    return draft
  }

  private beginTracking(): void {
    if (this.draftRevision !== undefined) return
    const stored = this.currentTable()
    this.baseline = stored === null ? emptyTable() : cloneTable(stored)
    this.guidanceBaseline = this.currentGuidance()
    this.draftRevision = this.scope.getSnapshot().revision
  }

  /**
   * A revision that lands this draft clears it. A revision that leaves the
   * table untouched advances the fence so a sibling field write can commit.
   */
  private noteRevision(): void {
    if (this.saving || (this.draft === undefined && this.guidanceDraft === undefined)) return
    if (this.scope.getSnapshot().revision === this.draftRevision) return
    const tableConflict = this.draft !== undefined
      && !samePurposeRouteTable(this.currentTable(), this.desiredTable())
      && !samePurposeRouteTable(this.currentTable(), this.baseline)
    const guidanceConflict = this.guidanceDraft !== undefined
      && !samePurposeGuidance(this.currentGuidance(), this.desiredGuidance())
      && !samePurposeGuidance(this.currentGuidance(), this.guidanceBaseline)
    if (tableConflict || guidanceConflict) {
      this.conflicted = true
      return
    }
    if (this.draft !== undefined && samePurposeRouteTable(this.currentTable(), this.desiredTable())) {
      this.draft = undefined
    }
    if (this.guidanceDraft !== undefined && samePurposeGuidance(this.currentGuidance(), this.desiredGuidance())) {
      this.guidanceDraft = undefined
    }
    if (this.draft === undefined && this.guidanceDraft === undefined) {
      this.releaseTracking()
      return
    }
    this.draftRevision = this.scope.getSnapshot().revision
    this.conflicted = false
  }

  private catalogModels(): Map<string, CatalogModel> {
    const models = new Map<string, CatalogModel>()
    for (const group of this.catalogGroups) {
      for (const model of group.models) {
        models.set(`${group.id}\0${model.id}`, {
          efforts: model.reasoning?.efforts.map(effort => ({ id: effort.id, name: effort.name })) ?? [],
          ...(model.reasoning?.defaultEffort === undefined ? {} : { defaultEffort: model.reasoning.defaultEffort }),
        })
      }
    }
    return models
  }

  private modelsOf(provider: string): readonly PurposeRouteOption[] {
    const group = this.catalogGroups.find(item => item.id === provider)
    return group?.models.map(model => ({ id: model.id, name: model.name })) ?? []
  }

  private defaultEffort(provider: string, model: string): string {
    const info = this.catalogModels().get(`${provider}\0${model}`)
    if (info === undefined) return ''
    if (info.defaultEffort !== undefined && info.efforts.some(effort => effort.id === info.defaultEffort)) {
      return info.defaultEffort
    }
    return info.efforts[0]?.id ?? ''
  }

  private applyField(route: DraftRoute, field: PurposeRouteField, value: string): DraftRoute {
    if (field === 'provider') {
      if (value === route.provider) return route
      const model = this.modelsOf(value)[0]?.id ?? ''
      return { ...route, provider: value, model, reasoningEffort: this.defaultEffort(value, model) }
    }
    if (field === 'model') {
      return { ...route, model: value, reasoningEffort: this.defaultEffort(route.provider, value) }
    }
    return { ...route, reasoningEffort: value }
  }

  private editRoute(slot: PurposeRouteSlot, index: number, field: PurposeRouteField, value: string): void {
    if (!this.canEdit()) return
    const draft = this.beginDraft()
    const routes = draft[slot]
    const current = routes[index] ?? (index === 0 && routes.length === 0 && slot !== 'review'
      ? this.placeholder(slot)
      : undefined)
    if (current === undefined) return
    const next = this.applyField(current, field, value)
    if (slot === 'review') routes[index] = next
    else draft[slot] = [next]
    this.failed = false
    this.publish()
  }

  private addReviewer(): void {
    if (!this.canEdit()) return
    const draft = this.beginDraft()
    draft.review.push({ id: this.mint(), provider: '', model: '', reasoningEffort: '' })
    this.failed = false
    this.publish()
  }

  private removeReviewer(index: number): void {
    if (!this.canEdit()) return
    const draft = this.beginDraft()
    if (draft.review.length <= 1) return
    if (index < 0 || index >= draft.review.length) return
    draft.review.splice(index, 1)
    this.failed = false
    this.publish()
  }

  private moveReviewer(index: number, direction: PurposeRouteMove): void {
    if (!this.canEdit()) return
    const draft = this.beginDraft()
    const next = direction === 'earlier' ? index - 1 : index + 1
    const route = draft.review[index]
    if (route === undefined || next < 0 || next >= draft.review.length) return
    draft.review.splice(index, 1)
    draft.review.splice(next, 0, route)
    this.failed = false
    this.publish()
  }

  private releaseTracking(): void {
    this.baseline = emptyTable()
    this.guidanceBaseline = null
    this.draftRevision = undefined
    this.failed = false
    this.conflicted = false
  }

  private clearDraft(): void {
    this.draft = undefined
    this.guidanceDraft = undefined
    this.releaseTracking()
  }

  private editGuidance(slot: GuidanceSlot, value: string): void {
    if (!this.canEdit()) return
    const next = cloneGuidance(this.displayedGuidance())
    next[slot] = value
    this.guidanceDraft = next
    this.beginTracking()
    this.failed = false
    this.publish()
  }

  private resetGuidance(): void {
    if (!this.canEdit()) return
    this.guidanceDraft = null
    this.beginTracking()
    this.failed = false
    this.publish()
  }

  private discard(): void {
    if (this.saving) return
    this.clearDraft()
    this.publish()
  }

  private async save(): Promise<void> {
    const snapshot = this.scope.getSnapshot()
    const desired = this.desiredTable()
    const state = this.projection()
    if (this.disposed || snapshot.status !== 'ready' || !snapshot.writable || this.saving
      || desired === null || !state.dirty || state.invalid) return
    /* jscpd:ignore-start -- both sections pass the same private save flags into beginRevisionSave. */
    const generation = beginRevisionSave({
      stale: (this.draft !== undefined || this.guidanceDraft !== undefined) && snapshot.revision !== this.draftRevision,
      saveGeneration: this.saveGeneration,
      publish: () => { this.publish() },
      markConflict: () => { this.conflicted = true },
      markSaving: () => { this.saving = true; this.failed = false; this.conflicted = false },
    })
    if (generation === undefined) return
    /* jscpd:ignore-end */
    const ops = []
    if (!samePurposeRouteTable(this.currentTable(), desired)) {
      ops.push({ op: 'set' as const, path: ['purposeRoutes'], value: desired })
    }
    const guidance = this.desiredGuidance()
    if (!samePurposeGuidance(this.currentGuidance(), guidance)) {
      ops.push({ op: 'set' as const, path: ['purposeGuidance'], value: guidance })
    }
    await this.scope.mutate(ops, this.draftRevision)
    if (generation !== this.saveGeneration) return
    const landed = samePurposeRouteTable(this.currentTable(), desired)
      && samePurposeGuidance(this.currentGuidance(), guidance)
    this.saving = false
    this.failed = !landed
    if (landed) this.clearDraft()
    this.publish()
  }

  /* jscpd:ignore-start -- both sections pass the same private catalog fields into loadSessionModelCatalog. */
  private loadCatalog(): Promise<void> {
    return loadSessionModelCatalog({
      disposed: this.disposed,
      status: this.catalogStatus,
      generation: this.catalogGeneration,
      readGeneration: () => this.catalogGeneration,
      publish: () => { this.publish() },
      markLoading: () => { this.catalogStatus = 'loading'; this.catalogPartial = false },
      fetch: () => this.ctx.remote.session.modelCatalog(),
      applyReady: (groups, partial) => {
        this.catalogGroups = groups
        this.catalogPartial = partial
        this.catalogStatus = 'ready'
      },
      applyError: () => { this.catalogStatus = 'error' },
    })
  }
  /* jscpd:ignore-end */

  private editor(route: DraftRoute, models: Map<string, CatalogModel>): PurposeRouteEditorState {
    const info = models.get(`${route.provider}\0${route.model}`)
    const available = info !== undefined
    const providers = this.catalogGroups.map(group => ({ id: group.id, name: group.name }))
    if (route.provider !== '' && !providers.some(option => option.id === route.provider)) {
      providers.push({ id: route.provider, name: route.provider })
    }
    const modelOptions = [...this.modelsOf(route.provider)]
    if (route.model !== '' && !modelOptions.some(option => option.id === route.model)) {
      modelOptions.push({ id: route.model, name: route.model })
    }
    const efforts = info === undefined ? [] : [...info.efforts]
    if (route.reasoningEffort !== '' && !efforts.some(option => option.id === route.reasoningEffort)) {
      efforts.push({ id: route.reasoningEffort, name: route.reasoningEffort })
    }
    return {
      id: route.id,
      provider: route.provider,
      model: route.model,
      reasoningEffort: route.reasoningEffort,
      available,
      missing: !isComplete(route),
      effortUnsupported: info !== undefined && route.reasoningEffort !== '' && !info.efforts.some(option => option.id === route.reasoningEffort),
      providers,
      models: modelOptions,
      efforts,
    }
  }

  private guidanceField(slot: GuidanceSlot, identifiers: readonly string[]): GuidanceFieldState {
    const text = this.displayedGuidance()[slot]
    const issue = guidanceIssue(slot, text, identifiers)
    return {
      slot,
      text,
      ...issue === undefined ? {} : { issue: issue.issue },
      ...issue?.identifier === undefined ? {} : { identifier: issue.identifier },
    }
  }

  private rows(): PurposeRouteRowState[] {
    const table = this.draft ?? this.viewTable()
    if (table === null) return []
    const models = this.catalogModels()
    const identifiers = routeIdentifiers(this.desiredTable())
    return PURPOSE_ROUTE_SLOTS.map((slot) => {
      const fanOut = FAN_OUT.has(slot)
      const stored = table[slot]
      const routes = stored.length === 0 && !fanOut
        ? [this.editor(this.placeholder(slot), models)]
        : stored.map(route => this.editor(route, models))
      return {
        slot,
        fanOut,
        routes,
        duplicate: hasDuplicate(stored),
        extra: !fanOut && stored.length > 1,
        empty: stored.length === 0,
        guidance: this.guidanceField(slot === 'default' ? 'omit' : slot, identifiers),
      }
    })
  }

  private viewTable(): DraftTable | null {
    const stored = this.currentTable()
    if (stored === null) return null
    const table = emptyTable() as DraftTable
    for (const slot of PURPOSE_ROUTE_SLOTS) {
      table[slot] = stored[slot].map((route, index) => ({ ...route, id: this.idFor(slot, index, route) }))
    }
    return table
  }

  private placeholder(slot: PurposeRouteSlot): DraftRoute {
    let id = this.placeholderIds.get(slot)
    if (id === undefined) {
      id = this.mint()
      this.placeholderIds.set(slot, id)
    }
    return { id, provider: '', model: '', reasoningEffort: '' }
  }

  private structurallyInvalid(rows: readonly PurposeRouteRowState[], splitting: GuidanceFieldState): boolean {
    return splitting.issue !== undefined || rows.some(row => row.empty || row.extra || row.duplicate
      || row.guidance.issue !== undefined
      || row.routes.some(route => route.missing || route.effortUnsupported))
  }

  private projection(): SubagentPurposeRoutesCardState {
    const snapshot = this.scope.getSnapshot()
    const rows = snapshot.status === 'ready' ? this.rows() : []
    const configured = this.desiredTable() !== null
    const dirty = this.dirty()
    const splitting = this.guidanceField('splitting', routeIdentifiers(this.desiredTable()))
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty,
      invalid: configured && (this.structurallyInvalid(rows, splitting) || (dirty && this.catalogStatus === 'loading')),
      saving: this.saving,
      failed: this.failed,
      configured,
      rows,
      catalogStatus: this.catalogStatus,
      catalogPartial: this.catalogPartial,
      conflicted: this.conflicted,
      splitting,
      guidanceBuiltin: this.desiredGuidance() === null,
    }
  }

  private publish(): void {
    this.store.set(this.projection())
  }
}
