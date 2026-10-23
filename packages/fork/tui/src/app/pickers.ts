/**
 * Pure picker state shared by the model and Session selectors.
 *
 * Both selectors are a filtered list plus a highlighted row, so the state
 * machine lives here independent of the terminal. The dialogs render
 * {@link PickerState} and forward keys; host enumeration produces the typed
 * option lists.
 * @module @anago-harness/tui/app/pickers
 */

/** One registered provider/model route the picker can apply. */
export interface ModelOption {
  /** Registered provider route. */
  readonly provider: string
  /** Provider-owned model id. */
  readonly model: string
  /** Display name from the provider catalog. */
  readonly label: string
  /** Optional catalog description. */
  readonly description?: string
  /** Whether this is the route the Agent currently uses. */
  readonly current: boolean
}

/** A provider/model pair the model picker applies. */
export interface ModelRoute {
  /** Registered provider route. */
  readonly provider: string
  /** Provider-owned model id. */
  readonly model: string
}

/** One stored Session the picker can resume. */
export interface SessionOption {
  /** Persisted Session id. */
  readonly id: string
  /** Creation time in Unix epoch milliseconds. */
  readonly createdAt: number
  /** Working directory recorded in the Session header, when present. */
  readonly cwd?: string
  /** Whether this is the Session the UI currently shows. */
  readonly current: boolean
  /**
   * Why the picker must refuse this Session.
   *
   * The row renders dimmed with this reason in place of its detail, and Enter
   * shows a notice instead of opening the Session. Hosts set it when another
   * process holds the Session's write lease.
   */
  readonly disabledReason?: string
}

/** One selectable row. */
export interface PickerItem {
  /** Opaque value handed to the command handler. */
  readonly value: string
  /** Primary label. */
  readonly label: string
  /** Secondary detail line. */
  readonly detail?: string
  /** Group heading shown above the first row of the group. */
  readonly group?: string
  /**
   * Refusal that turns the row into a visible but unchosen entry.
   *
   * The picker dims the label, replaces the detail with the reason, and shows
   * the reason in a notice when Enter would otherwise choose the row.
   */
  readonly disabled?: { readonly reason: string }
}

/** Filtered picker state. */
export interface PickerState {
  /** Every row in display order. */
  readonly items: readonly PickerItem[]
  /** Current filter text. */
  readonly query: string
  /** Highlighted index within the filtered list. */
  readonly index: number
}

/** Separator inside an opaque model value. */
const MODEL_VALUE_SEPARATOR = '\u001f'

/**
 * Build a picker over a fixed row list.
 * @param items - selectable rows in display order.
 * @returns the initial state with no filter.
 */
export function pickerStateOf(items: readonly PickerItem[]): PickerState {
  return { items, query: '', index: 0 }
}

/**
 * Rows matching the current query.
 *
 * Every whitespace-separated term must occur in the row's label, value, detail,
 * or group, so `deepseek pro` narrows to one provider and model.
 * @param state - picker state.
 * @returns filtered rows in display order.
 */
export function visiblePickerItems(state: PickerState): readonly PickerItem[] {
  const terms = state.query.toLowerCase().split(/\s+/u).filter(term => term !== '')
  if (terms.length === 0) return state.items
  return state.items.filter((item) => {
    const haystack = `${item.label} ${item.value} ${item.detail ?? ''} ${item.group ?? ''}`.toLowerCase()
    return terms.every(term => haystack.includes(term))
  })
}

/**
 * The highlighted row.
 * @param state - picker state.
 * @returns the row, or `undefined` when the filter matches nothing.
 */
export function pickerSelection(state: PickerState): PickerItem | undefined {
  const visible = visiblePickerItems(state)
  if (visible.length === 0) return undefined
  const index = Math.min(Math.max(state.index, 0), visible.length - 1)
  return visible[index]
}

/**
 * Move the highlight, wrapping at both ends.
 * @param state - picker state.
 * @param delta - rows to move; negative moves up.
 * @returns the next state.
 */
export function pickerMove(state: PickerState, delta: number): PickerState {
  const visible = visiblePickerItems(state)
  if (visible.length === 0) return state.index === 0 ? state : { ...state, index: 0 }
  const next = ((state.index + delta) % visible.length + visible.length) % visible.length
  return next === state.index ? state : { ...state, index: next }
}

/**
 * Replace the filter text and reset the highlight.
 * @param state - picker state.
 * @param query - next filter text.
 * @returns the next state.
 */
export function pickerQuery(state: PickerState, query: string): PickerState {
  if (query === state.query) return state
  return { ...state, query, index: 0 }
}

/**
 * Append one typed character.
 * @param state - picker state.
 * @param text - typed text.
 * @returns the next state.
 */
export function pickerAppend(state: PickerState, text: string): PickerState {
  return pickerQuery(state, state.query + text)
}

/**
 * Remove the last character of the filter.
 * @param state - picker state.
 * @returns the next state.
 */
export function pickerBackspace(state: PickerState): PickerState {
  if (state.query === '') return state
  return pickerQuery(state, Array.from(state.query).slice(0, -1).join(''))
}

/**
 * Build rows for the registered routes.
 * @param options - routes from the LLM catalog.
 * @returns rows grouped by provider.
 */
export function modelPickerItems(options: readonly ModelOption[]): readonly PickerItem[] {
  return options.map((option) => {
    const facts = option.description === undefined ? option.model : `${option.model} — ${option.description}`
    return {
      value: modelValue(option),
      label: `${option.label}${option.current ? ' (current)' : ''}`,
      ...option.label === option.model && option.description === undefined ? {} : { detail: facts },
      group: option.provider,
    }
  })
}

/**
 * Encode one route as a picker value.
 * @param option - route to encode.
 * @returns the opaque value.
 */
export function modelValue(option: ModelOption): string {
  return `${option.provider}${MODEL_VALUE_SEPARATOR}${option.model}`
}

/**
 * Decode one picker value back into a route.
 * @param value - value produced by {@link modelValue}.
 * @returns the provider and model, or `undefined` for a malformed value.
 */
export function parseModelValue(value: string): { provider: string; model: string } | undefined {
  const separator = value.indexOf(MODEL_VALUE_SEPARATOR)
  if (separator <= 0) return undefined
  const provider = value.slice(0, separator)
  const model = value.slice(separator + 1)
  if (model === '') return undefined
  return { provider, model }
}

/**
 * Format a stored Session's creation time relative to now.
 * @param createdAt - creation time in Unix epoch milliseconds.
 * @param now - reference time in Unix epoch milliseconds.
 * @returns `just now`, a minutes/hours/days age, or a `YYYY-MM-DD` date.
 */
export function formatRelativeTime(createdAt: number, now: number): string {
  const elapsed = Math.max(0, now - createdAt)
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${String(minutes)}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${String(hours)}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${String(days)}d ago`
  const date = new Date(createdAt)
  return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/**
 * Local date bucket used to group stored Sessions.
 * @param createdAt - creation time in Unix epoch milliseconds.
 * @param now - reference time in Unix epoch milliseconds.
 * @returns `Today`, `Yesterday`, or a `YYYY-MM-DD` date.
 */
function sessionGroup(createdAt: number, now: number): string {
  const day = 24 * 60 * 60 * 1_000
  const today = new Date(now)
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const startOfCreated = new Date(createdAt)
  const startOfCreatedDay = new Date(
    startOfCreated.getFullYear(),
    startOfCreated.getMonth(),
    startOfCreated.getDate(),
  ).getTime()
  if (startOfCreatedDay >= startOfToday) return 'Today'
  if (startOfCreatedDay >= startOfToday - day) return 'Yesterday'
  return formatRelativeTime(createdAt, now)
}

/**
 * Build rows for the stored Sessions.
 * @param options - Sessions from the profile's session store, newest first.
 * @param now - reference time for the age labels.
 * @returns selectable rows; a Session with a `disabledReason` carries that refusal.
 */
export function sessionPickerItems(options: readonly SessionOption[], now: number): readonly PickerItem[] {
  return options.map((option) => {
    const location = option.cwd === undefined ? 'no cwd' : basename(option.cwd)
    return {
      value: option.id,
      label: `${formatRelativeTime(option.createdAt, now)} · ${location}${option.current ? ' (current)' : ''}`,
      detail: option.id,
      group: sessionGroup(option.createdAt, now),
      ...option.disabledReason === undefined ? {} : { disabled: { reason: option.disabledReason } },
    }
  })
}

/**
 * Last path segment, tolerating both path separators.
 * @param path - absolute path.
 * @returns the final segment, or the original value.
 */
function basename(path: string): string {
  const segments = path.split(/[\\/]/u).filter(segment => segment !== '')
  return segments.at(-1) ?? path
}
