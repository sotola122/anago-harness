import { describe, expect, it } from 'vitest'
import {
  formatRelativeTime,
  modelPickerItems,
  modelValue,
  parseModelValue,
  pickerAppend,
  pickerBackspace,
  pickerMove,
  pickerQuery,
  pickerSelection,
  pickerStateOf,
  sessionPickerItems,
  visiblePickerItems,
  type ModelOption,
  type PickerState,
  type SessionOption,
} from '../src/app/pickers.ts'

/** Routes used by the picker tests. */
const MODELS: readonly ModelOption[] = [
  { provider: 'deepseek', model: 'deepseek-v4', label: 'DeepSeek V4', description: 'flagship', current: true },
  { provider: 'deepseek', model: 'deepseek-flash', label: 'DeepSeek Flash', current: false },
  { provider: 'local', model: 'qwen', label: 'Qwen', current: false },
]

describe('picker state machine', () => {
  const state = pickerStateOf([
    { value: 'a', label: 'Alpha', detail: 'first', group: 'One' },
    { value: 'b', label: 'Beta', detail: 'second', group: 'One' },
    { value: 'c', label: 'Gamma', detail: 'third', group: 'Two' },
  ])

  it('lists every row without a query', () => {
    expect(visiblePickerItems(state)).toHaveLength(3)
    expect(pickerSelection(state)?.value).toBe('a')
  })

  it('filters across labels, values, details, and groups', () => {
    expect(visiblePickerItems(pickerQuery(state, 'bet')).map(item => item.value)).toEqual(['b'])
    expect(visiblePickerItems(pickerQuery(state, 'two')).map(item => item.value)).toEqual(['c'])
    expect(visiblePickerItems(pickerQuery(state, 'ONE alpha')).map(item => item.value)).toEqual(['a'])
    expect(visiblePickerItems(pickerQuery(state, 'nothing'))).toHaveLength(0)
    expect(pickerSelection(pickerQuery(state, 'nothing'))).toBeUndefined()
  })

  it('appends and removes filter characters', () => {
    let next = pickerAppend(state, 'g')
    next = pickerAppend(next, 'a')
    expect(next.query).toBe('ga')
    next = pickerBackspace(next)
    expect(next.query).toBe('g')
    expect(pickerBackspace(pickerStateOf([])).query).toBe('')
  })

  it('moves the highlight and wraps at both ends', () => {
    expect(pickerMove(state, 1).index).toBe(1)
    expect(pickerMove(pickerMove(state, 2), 1).index).toBe(0)
    expect(pickerMove(state, -1).index).toBe(2)
    expect(pickerSelection(pickerMove(state, 1))?.value).toBe('b')
  })

  it('resets the highlight when the filter changes', () => {
    expect(pickerQuery(pickerMove(state, 2), 'a').index).toBe(0)
  })

  it('keeps the highlight inside a shrinking result set', () => {
    const narrowed = pickerQuery(pickerMove(state, 2), 'al')
    expect(pickerSelection(narrowed)?.value).toBe('a')
  })
})

describe('model picker rows', () => {
  it('marks the current route and groups by provider', () => {
    const items = modelPickerItems(MODELS)
    expect(items.map(item => item.group)).toEqual(['deepseek', 'deepseek', 'local'])
    expect(items[0]).toMatchObject({ label: 'DeepSeek V4 (current)', group: 'deepseek' })
    expect(items[1]?.label).toBe('DeepSeek Flash')
    expect(items[1]?.detail).toContain('deepseek-flash')
  })

  it('round-trips a route through its opaque value', () => {
    expect(parseModelValue(modelValue(MODELS[0] as ModelOption)))
      .toEqual({ provider: 'deepseek', model: 'deepseek-v4' })
    expect(parseModelValue('')).toBeUndefined()
    expect(parseModelValue('no-separator')).toBeUndefined()
    expect(parseModelValue('\u001fmodel')).toBeUndefined()
  })
})

describe('Session picker rows', () => {
  const now = new Date(2026, 9, 22, 12, 0, 0).getTime()
  const sessions: readonly SessionOption[] = [
    { id: 'session-a', createdAt: now - 5 * 60_000, cwd: '/repo/anago', current: true },
    { id: 'session-b', createdAt: now - 26 * 60 * 60_000, cwd: '/repo/other', current: false },
    { id: 'session-c', createdAt: new Date(2026, 8, 1, 9, 0, 0).getTime(), current: false },
  ]

  it('labels rows with their age, directory, and current marker', () => {
    const items = sessionPickerItems(sessions, now)
    expect(items[0]).toMatchObject({
      value: 'session-a',
      label: '5m ago · anago (current)',
      detail: 'session-a',
      group: 'Today',
    })
    expect(items[1]).toMatchObject({ label: '1d ago · other', group: 'Yesterday' })
    expect(items[2]?.group).toBe('2026-09-01')
  })

  it('formats relative ages at each boundary', () => {
    expect(formatRelativeTime(now - 30_000, now)).toBe('just now')
    expect(formatRelativeTime(now - 59 * 60_000, now)).toBe('59m ago')
    expect(formatRelativeTime(now - 2 * 60 * 60_000, now)).toBe('2h ago')
    expect(formatRelativeTime(now - 3 * 24 * 60 * 60_000, now)).toBe('3d ago')
    expect(formatRelativeTime(new Date(2026, 0, 2).getTime(), now)).toBe('2026-01-02')
  })
})

describe('picker edge cases', () => {
  it('filters rows that carry neither detail nor group metadata', () => {
    const bare = pickerStateOf([{ value: 'alpha', label: 'Alpha' }])

    expect(visiblePickerItems(pickerQuery(bare, 'alph')).map(item => item.value)).toEqual(['alpha'])
    expect(visiblePickerItems(pickerQuery(bare, 'missing'))).toEqual([])
  })

  it('keeps the same state when a move lands on the current row', () => {
    const atStart = pickerStateOf([
      { value: 'a', label: 'Alpha' },
      { value: 'b', label: 'Beta' },
    ])

    expect(pickerMove(atStart, 2)).toBe(atStart)
    expect(pickerQuery(atStart, '')).toBe(atStart)
  })

  it('normalizes a highlight that no visible row backs', () => {
    const orphaned: PickerState = { items: [], query: 'missing', index: 4 }
    const empty = pickerStateOf([])

    expect(pickerMove(empty, 1)).toBe(empty)
    expect(pickerMove(orphaned, 1)).toEqual({ items: [], query: 'missing', index: 0 })
    expect(pickerSelection(orphaned)).toBeUndefined()
  })

  it('keeps a model row without a description free of detail text', () => {
    const [plain] = modelPickerItems([{ provider: 'local', model: 'qwen', label: 'qwen', current: false }])
    expect(plain?.detail).toBeUndefined()

    const [described] = modelPickerItems([
      { provider: 'local', model: 'qwen', label: 'qwen', description: 'Local route', current: false },
    ])
    expect(described?.detail).toBe('qwen — Local route')
  })

  it('rejects a model value whose model half is empty', () => {
    expect(parseModelValue('deepseek\u001f')).toBeUndefined()
  })

  it('keeps a Session whose directory has no final segment', () => {
    const now = Date.now()
    const [row] = sessionPickerItems([{ id: 'session-root', createdAt: now, cwd: '/', current: false }], now)

    expect(row?.label).toBe('just now · /')
  })
})
