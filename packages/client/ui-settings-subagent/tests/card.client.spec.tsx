// @vitest-environment jsdom
/** The Subagent page as the Plugins page renders it: both sections on one page with one save. */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SubagentCard, type SubagentCardProps } from '../src/client/SubagentCard.tsx'
import type { SubagentLimitsCardState } from '../src/client/subagent-limits-card-controller.ts'
import type { SettingsFieldState, SettingsFormShell } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SubagentModelSelectionCardState } from '../src/client/subagent-model-selection-card-controller.ts'
import type { SubagentPurposeRoutesCardState } from '../src/client/subagent-purpose-routes-card-controller.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: keyof typeof en) => en[key]

const settled: SettingsFormShell = {
  available: true,
  writable: true,
  dirty: false,
  invalid: false,
  saving: false,
  failed: false,
}

function field(text: string, rest: Partial<SettingsFieldState> = {}): SettingsFieldState {
  return { text, overridden: false, invalid: false, ...rest }
}

/** The Plugins page asks a configuration entry for its one-liner or its form; every page renders as `page` unless a test says otherwise. */
type ConfigView = 'summary' | 'page'

function renderSubagent(
  limitState: Partial<SubagentLimitsCardState> = {},
  modelState: Partial<SubagentModelSelectionCardState> = {},
  view: ConfigView = 'page',
  purposeState: Partial<SubagentPurposeRoutesCardState> = {},
) {
  const limits = createSnapshotStore<SubagentLimitsCardState>({
    ...settled,
    maxDepth: field('3'),
    maxActiveSubagents: field('8'),
    ...limitState,
  })
  const models = createSnapshotStore<SubagentModelSelectionCardState>({
    ...settled,
    enabled: false,
    candidates: [],
    catalogStatus: 'idle',
    catalogPartial: false,
    conflicted: false,
    ...modelState,
  })
  const purpose = createSnapshotStore<SubagentPurposeRoutesCardState>({
    ...settled,
    available: false,
    configured: false,
    rows: [],
    catalogStatus: 'idle',
    catalogPartial: false,
    conflicted: false,
    ...purposeState,
  })
  const actions = {
    editLimit: vi.fn(),
    resetLimit: vi.fn(),
    toggleEnabled: vi.fn(),
    toggleModel: vi.fn(),
    retryCatalog: vi.fn(),
    editPurposeRoute: vi.fn(),
    addReviewer: vi.fn(),
    removeReviewer: vi.fn(),
    moveReviewer: vi.fn(),
    retryPurposeCatalog: vi.fn(),
    save: vi.fn(),
    discard: vi.fn(),
  }
  const props = {
    ...actions,
    view,
    t,
    useSubagentLimitsCard: bindSnapshotSelector(limits),
    useSubagentModelSelectionCard: bindSnapshotSelector(models),
    useSubagentPurposeRoutesCard: bindSnapshotSelector(purpose),
  } as SubagentCardProps
  render(<SubagentCard {...props} />)
  return { actions, limits, models, purpose }
}

function renderSubagentModelSelection(state: Partial<SubagentModelSelectionCardState> = {}, view: ConfigView = 'page') {
  return renderSubagent({ available: false }, state, view).actions
}

describe('Subagent model selection fields', () => {
  it('renders the default-off preference in its staged plugin card', () => {
    const actions = renderSubagentModelSelection()

    const control = screen.getByRole('switch', { name: en.subagentModelSelectionToggle })
    expect(control.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(control)

    expect(actions.toggleEnabled).toHaveBeenCalledOnce()
  })

  it('groups available adapter candidates by provider', () => {
    const actions = renderSubagentModelSelection({
      enabled: true,
      candidates: [
        {
          key: 'alpha\0fast',
          provider: 'alpha',
          model: 'fast',
          providerName: 'Alpha API',
          modelName: 'Fast',
          available: true,
          selected: true,
        },
        {
          key: 'alpha\0deep',
          provider: 'alpha',
          model: 'deep',
          providerName: 'Alpha API',
          modelName: 'Deep',
          available: true,
          selected: false,
        },
      ],
      catalogStatus: 'ready',
    })

    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText('Alpha API', { exact: true })).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: /Fast/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Deep/ }))
    expect(actions.toggleModel).toHaveBeenCalledWith('alpha\0fast')
    expect(actions.toggleModel).toHaveBeenCalledWith('alpha\0deep')
  })

  it('renders directory progress, failures, unavailable routes, and validation', () => {
    renderSubagentModelSelection({ enabled: true, catalogStatus: 'loading', invalid: true })
    expect(screen.getByText(en.subagentModelSelectionLoading)).toBeTruthy()
    expect(screen.getByText(en.subagentModelSelectionRequired)).toBeTruthy()

    cleanup()
    const errorActions = renderSubagentModelSelection({ enabled: true, catalogStatus: 'error' })
    fireEvent.click(screen.getByRole('button', { name: en.subagentModelSelectionRetry }))
    expect(errorActions.retryCatalog).toHaveBeenCalledOnce()

    cleanup()
    renderSubagentModelSelection({
      enabled: true,
      catalogStatus: 'ready',
      catalogPartial: true,
      candidates: [{
        key: 'legacy\0old',
        provider: 'legacy',
        model: 'old',
        providerName: 'legacy',
        modelName: 'old',
        available: false,
        selected: true,
      }],
    })
    expect(screen.getByText(en.subagentModelSelectionPartial)).toBeTruthy()
    expect(screen.getByText(en.subagentModelSelectionUnavailable)).toBeTruthy()
    expect(screen.getByText(en.subagentModelSelectionUnavailableGroup)).toBeTruthy()

    cleanup()
    renderSubagentModelSelection({ enabled: true, catalogStatus: 'ready' })
    expect(screen.getByText(en.subagentModelSelectionEmpty)).toBeTruthy()
  })

  it('distinguishes a stale draft from a rejected save', () => {
    renderSubagentModelSelection({ dirty: true, conflicted: true })

    expect(screen.getByText(en.subagentModelSelectionConflict)).toBeTruthy()
    expect(screen.queryByText(en.saveFailed)).toBeNull()
  })

  it('renders its one-liner in the summary view, says so when unavailable, and disables writes when read-only', () => {
    renderSubagentModelSelection({}, 'summary')
    expect(document.body.textContent).toBe(en.subagentDescription)

    cleanup()
    renderSubagentModelSelection({ available: false })
    expect(screen.getByRole('status').textContent).toBe(en.unavailable)

    cleanup()
    const actions = renderSubagentModelSelection({ writable: false })
    const control = screen.getByRole('switch') as HTMLButtonElement
    expect(control.disabled).toBe(true)
    fireEvent.click(control)
    expect(actions.toggleEnabled).not.toHaveBeenCalled()
  })
})

describe('SubagentCard', () => {
  it('discards both drafts when leaving the page', () => {
    const { actions } = renderSubagent({ dirty: true }, { dirty: true })
    cleanup()
    expect(actions.discard).toHaveBeenCalledOnce()
  })

  it('renders limits without model selection when only limits are served', () => {
    renderSubagent({}, { available: false })
    expect(screen.getByLabelText(en.subagentMaxDepth)).toBeTruthy()
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('shows both sections on one page with one save footer', () => {
    renderSubagent({ dirty: true })

    expect(screen.getByRole('heading', { name: en.subagentLimitsTitle })).toBeTruthy()
    expect(screen.getByRole('heading', { name: en.subagentModelSelectionTitle })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: en.save })).toHaveLength(1)
  })

  it('reveals field rules on demand without changing staged values', () => {
    renderSubagent({ dirty: true, maxDepth: field('2') })
    const depthHelp = screen.getByRole('button', { name: en.subagentDepthHelpLabel })
    const capacityHelp = screen.getByRole('button', { name: en.subagentCapacityHelpLabel })
    expect(depthHelp.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText(en.subagentDepthHelp)).toBeNull()
    expect(screen.queryByText(en.subagentCapacityHelp)).toBeNull()

    fireEvent.click(depthHelp)
    expect(depthHelp.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('region', { name: en.subagentDepthHelpLabel })).toBeTruthy()
    expect(screen.getByText(en.subagentDepthHelp)).toBeTruthy()
    expect(screen.getByRole('table', { name: en.subagentDepthHelpLabel })).toBeTruthy()
    expect(screen.getByRole('row', { name: `0 ${en.subagentDepthZero}` })).toBeTruthy()
    expect(screen.getByRole('row', { name: `1 ${en.subagentDepthOne}` })).toBeTruthy()
    expect(screen.getByText(en.subagentDepthOverride)).toBeTruthy()
    fireEvent.click(capacityHelp)
    expect(screen.getByText(en.subagentCapacityHelp)).toBeTruthy()
    fireEvent.click(depthHelp)
    expect(screen.queryByText(en.subagentDepthHelp)).toBeNull()
    expect(screen.getByLabelText(en.subagentMaxDepth)).toHaveProperty('value', '2')
    expect(screen.getByRole('button', { name: en.save })).toHaveProperty('disabled', false)
  })

  it('keeps validation visible when the rules are collapsed and links it to the input', () => {
    renderSubagent({ dirty: true, invalid: true, maxDepth: field('1.5', { invalid: true }) })
    const depth = screen.getByLabelText(en.subagentMaxDepth)
    const messageId = depth.getAttribute('aria-describedby')!
    expect(document.getElementById(messageId)?.textContent).toBe(en.subagentDepthInvalid)
    expect(screen.queryByRole('region', { name: en.subagentDepthHelpLabel })).toBeNull()
  })

  it('edits and resets limits through the shared card', () => {
    const { actions, limits } = renderSubagent({
      dirty: true,
      maxDepth: field('3', { overridden: true }),
      maxActiveSubagents: field('8', { overridden: true }),
    })
    fireEvent.change(screen.getByLabelText(en.subagentMaxDepth), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText(en.subagentMaxActive), { target: { value: '12' } })
    expect(actions.editLimit.mock.calls).toEqual([['maxDepth', '2'], ['maxActiveSubagents', '12']])
    for (const button of screen.getAllByRole('button', { name: en.reset })) fireEvent.click(button)
    expect(actions.resetLimit.mock.calls).toEqual([['maxDepth'], ['maxActiveSubagents']])
    act(() => { limits.set({ ...limits.getSnapshot(), writable: false }) })
    expect(screen.getByLabelText(en.subagentMaxActive)).toHaveProperty('disabled', true)
  })

  it('blocks saving both sections when a model selection is invalid or conflicted', () => {
    const { models } = renderSubagent({ dirty: true }, { dirty: true, invalid: true })
    expect(screen.getByRole('button', { name: en.save })).toHaveProperty('disabled', true)
    act(() => { models.set({ ...models.getSnapshot(), invalid: false, conflicted: true }) })
    expect(screen.getByRole('button', { name: en.save })).toHaveProperty('disabled', true)
  })

  it('locks both sections while either is saving and stays open after both settle', () => {
    const { limits, models } = renderSubagent({ dirty: true }, { dirty: true })
    act(() => {
      limits.set({ ...limits.getSnapshot(), saving: true })
      models.set({ ...models.getSnapshot(), saving: true })
    })
    expect(screen.getByLabelText(en.subagentMaxDepth)).toHaveProperty('disabled', true)
    expect(screen.getByRole('switch')).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: en.saving })).toHaveProperty('disabled', true)
    act(() => { limits.set({ ...limits.getSnapshot(), saving: false, dirty: false }) })
    expect(screen.getByRole('switch')).toHaveProperty('disabled', true)
    act(() => { models.set({ ...models.getSnapshot(), saving: false, dirty: false }) })
    expect(screen.getByRole('switch')).toHaveProperty('disabled', false)
    expect(screen.getByRole('button', { name: en.save })).toHaveProperty('disabled', true)
  })

  it('keeps a rejected section open after the other section saves', () => {
    const { limits, models } = renderSubagent({ dirty: true }, { dirty: true })
    act(() => {
      limits.set({ ...limits.getSnapshot(), saving: true })
      models.set({ ...models.getSnapshot(), saving: true })
    })
    act(() => {
      limits.set({ ...limits.getSnapshot(), saving: false, dirty: false })
      models.set({ ...models.getSnapshot(), saving: false, failed: true })
    })
    expect(screen.getByRole('switch')).toBeTruthy()
    expect(screen.getByText(en.saveFailed)).toBeTruthy()
    expect(screen.getByRole('button', { name: en.save })).toHaveProperty('disabled', false)
  })

  it('renders model-only deployments without limit controls', () => {
    renderSubagent({ available: false })
    expect(screen.getByRole('switch')).toBeTruthy()
    expect(screen.queryByLabelText(en.subagentMaxDepth)).toBeNull()
  })

  it('shows an empty purpose section when routing is off and no way to create a table', () => {
    renderSubagent({}, {}, 'page', { available: true, configured: false })
    expect(screen.getByRole('heading', { name: en['purposeRoutes.title'] })).toBeTruthy()
    expect(screen.getByText(en['purposeRoutes.notConfigured'])).toBeTruthy()
    expect(screen.queryByRole('button', { name: en['purposeRoutes.addReviewer'] })).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('edits one route per purpose and several reviewers on review', () => {
    const actions = renderSubagent({}, { available: false }, 'page', {
      available: true,
      configured: true,
      rows: [
        row('light', [route('light-1', { provider: 'alpha', model: 'fast', reasoningEffort: 'low' })]),
        row('medium', [route('medium-1', { provider: 'alpha', model: 'fast', reasoningEffort: 'low' })]),
        row('deep', [route('deep-1', { provider: 'alpha', model: 'fast', reasoningEffort: 'high' })]),
        row('review', [
          route('review-1', { provider: 'alpha', model: 'fast', reasoningEffort: 'high' }),
          route('review-2', { provider: 'beta', model: 'slow', reasoningEffort: 'high', available: false }),
        ], { fanOut: true }),
        row('writing', [route('writing-1', { provider: 'alpha', model: 'fast', reasoningEffort: 'low' })]),
        row('default', [route('default-1', { provider: 'alpha', model: 'fast', reasoningEffort: 'high' })]),
      ],
    }).actions
    expect(screen.getByRole('heading', { name: en['purposeRoutes.slot.light.label'] })).toBeTruthy()
    expect(screen.getByRole('heading', { name: en['purposeRoutes.slot.medium.label'] })).toBeTruthy()
    expect(screen.getByRole('heading', { name: en['purposeRoutes.slot.writing.label'] })).toBeTruthy()
    expect(screen.getByRole('heading', { name: en['purposeRoutes.slot.default.label'] })).toBeTruthy()
    expect(screen.getByText(en['purposeRoutes.slot.medium.hint'])).toBeTruthy()
    expect(screen.getByText(en['purposeRoutes.slot.writing.hint'])).toBeTruthy()
    expect(screen.getByText(en['purposeRoutes.slot.default.hint'])).toBeTruthy()
    expect(screen.getAllByRole('button', { name: en['purposeRoutes.addReviewer'] })).toHaveLength(1)
    expect(screen.getByText(en['purposeRoutes.warnings.providerUnavailable'])).toBeTruthy()
    fireEvent.change(screen.getAllByLabelText(en['purposeRoutes.provider'])[0]!, { target: { value: 'beta' } })
    expect(actions.editPurposeRoute).toHaveBeenCalledWith('light', 0, 'provider', 'beta')
    fireEvent.click(screen.getByRole('button', { name: en['purposeRoutes.addReviewer'] }))
    expect(actions.addReviewer).toHaveBeenCalledOnce()
    const remove = screen.getAllByRole('button', { name: en['purposeRoutes.removeReviewer'] })
    expect(remove[0]).toHaveProperty('disabled', false)
    fireEvent.click(remove[1]!)
    expect(actions.removeReviewer).toHaveBeenCalledWith(1)
    fireEvent.click(screen.getAllByRole('button', { name: en['purposeRoutes.moveLater'] })[0]!)
    expect(actions.moveReviewer).toHaveBeenCalledWith(0, 'later')
    expect(screen.getAllByRole('button', { name: en['purposeRoutes.moveEarlier'] })[0]).toHaveProperty('disabled', true)
  })

  it('shows validation, a catalogue failure, and a revision conflict on the purpose section', () => {
    const { actions, purpose } = renderSubagent({}, { available: false }, 'page', {
      available: true,
      configured: true,
      dirty: true,
      invalid: true,
      catalogStatus: 'error',
      rows: [row('deep', [route('deep-1', { missing: true, effortUnsupported: true })], { extra: true, duplicate: true, empty: true })],
    })
    expect(screen.getByText(en['purposeRoutes.errors.missingRoute'])).toBeTruthy()
    expect(screen.getByText(en['purposeRoutes.errors.effortUnsupported'])).toBeTruthy()
    expect(screen.getByText(en['purposeRoutes.errors.duplicateRoute'])).toBeTruthy()
    expect(screen.getByText(en['purposeRoutes.errors.extraRoute'])).toBeTruthy()
    expect(screen.getByText(en['purposeRoutes.emptySlot'])).toBeTruthy()
    expect(screen.getByRole('button', { name: en.save })).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('button', { name: en.subagentModelSelectionRetry }))
    expect(actions.retryPurposeCatalog).toHaveBeenCalledOnce()
    act(() => { purpose.set({ ...purpose.getSnapshot(), invalid: false, conflicted: true, catalogStatus: 'ready' }) })
    expect(screen.getByText(en.subagentModelSelectionConflict)).toBeTruthy()
    expect(screen.getByRole('button', { name: en.save })).toHaveProperty('disabled', true)
    cleanup()
    renderSubagent({}, { available: false }, 'page', {
      available: true,
      configured: true,
      catalogStatus: 'loading',
      catalogPartial: true,
      rows: [],
    })
    expect(screen.getByText(en.subagentModelSelectionLoading)).toBeTruthy()
    expect(screen.getByText(en.subagentModelSelectionPartial)).toBeTruthy()
  })
})

function route(
  id: string,
  rest: Partial<import('../src/client/subagent-purpose-routes-card-controller.ts').PurposeRouteEditorState> = {},
): import('../src/client/subagent-purpose-routes-card-controller.ts').PurposeRouteEditorState {
  return {
    id,
    provider: '',
    model: '',
    reasoningEffort: '',
    available: true,
    missing: false,
    effortUnsupported: false,
    providers: [{ id: 'alpha', name: 'Alpha' }, { id: 'beta', name: 'Beta' }],
    models: [{ id: 'fast', name: 'Fast' }],
    efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }],
    ...rest,
  }
}

function row(
  slot: import('../src/client/subagent-purpose-routes-card-controller.ts').PurposeRouteSlot,
  routes: import('../src/client/subagent-purpose-routes-card-controller.ts').PurposeRouteEditorState[],
  rest: Partial<import('../src/client/subagent-purpose-routes-card-controller.ts').PurposeRouteRowState> = {},
): import('../src/client/subagent-purpose-routes-card-controller.ts').PurposeRouteRowState {
  return { slot, fanOut: false, routes, duplicate: false, extra: false, empty: false, ...rest }
}
