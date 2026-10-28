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

/** Settings field this editor reads and writes. Other fields on the form are ignored. */
export interface PurposeRoutesSettings {
  purposeRoutes?: PurposeRouteTableDraft | null
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
  /** Persist the whole table as one revision-fenced mutation. */
  save: () => Promise<void>
  /** Drop the staged table. */
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

  private dirty(): boolean {
    return !samePurposeRouteTable(this.currentTable(), this.desiredTable())
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
    this.baseline = cloneTable(stored)
    this.draftRevision = this.scope.getSnapshot().revision
    return draft
  }

  /**
   * A revision that lands this draft clears it. A revision that leaves the
   * table untouched advances the fence so a sibling field write can commit.
   */
  private noteRevision(): void {
    if (this.saving || this.draft === undefined) return
    if (this.scope.getSnapshot().revision === this.draftRevision) return
    if (samePurposeRouteTable(this.currentTable(), this.desiredTable())) {
      this.clearDraft()
      return
    }
    if (samePurposeRouteTable(this.currentTable(), this.baseline)) {
      this.draftRevision = this.scope.getSnapshot().revision
      this.conflicted = false
      return
    }
    this.conflicted = true
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

  private clearDraft(): void {
    this.draft = undefined
    this.baseline = emptyTable()
    this.draftRevision = undefined
    this.failed = false
    this.conflicted = false
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
      stale: this.draft !== undefined && snapshot.revision !== this.draftRevision,
      saveGeneration: this.saveGeneration,
      publish: () => { this.publish() },
      markConflict: () => { this.conflicted = true },
      markSaving: () => { this.saving = true; this.failed = false; this.conflicted = false },
    })
    if (generation === undefined) return
    /* jscpd:ignore-end */
    await this.scope.mutate([{ op: 'set', path: ['purposeRoutes'], value: desired }], this.draftRevision)
    if (generation !== this.saveGeneration) return
    const landed = samePurposeRouteTable(this.currentTable(), desired)
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

  private rows(): PurposeRouteRowState[] {
    const table = this.draft ?? this.viewTable()
    if (table === null) return []
    const models = this.catalogModels()
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

  private structurallyInvalid(rows: readonly PurposeRouteRowState[]): boolean {
    return rows.some(row => row.empty || row.extra || row.duplicate || row.routes.some(route => route.missing || route.effortUnsupported))
  }

  private projection(): SubagentPurposeRoutesCardState {
    const snapshot = this.scope.getSnapshot()
    const rows = snapshot.status === 'ready' ? this.rows() : []
    const configured = this.desiredTable() !== null
    const dirty = this.dirty()
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty,
      invalid: configured && (this.structurallyInvalid(rows) || (dirty && this.catalogStatus === 'loading')),
      saving: this.saving,
      failed: this.failed,
      configured,
      rows,
      catalogStatus: this.catalogStatus,
      catalogPartial: this.catalogPartial,
      conflicted: this.conflicted,
    }
  }

  private publish(): void {
    this.store.set(this.projection())
  }
}
