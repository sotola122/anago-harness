// @vitest-environment jsdom
/** The two provider cards as the Plugins page renders them: switch, key control, provider fields, and their resets. */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsFieldState, SettingsFormShell } from '@deepseek-ai/dsh-client-ui-primitives'
import { WebSearchProviderCard, type WebSearchProviderCardProps } from '../src/client/WebSearchProviderCard.tsx'
import type { WebSearchProviderCardState } from '../src/client/web-search-provider-card-controller.ts'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: keyof typeof en) => en[key]

const settled: SettingsFormShell = {
  available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false,
}

function field(text: string, rest: Partial<SettingsFieldState> = {}): SettingsFieldState {
  return { text, overridden: false, invalid: false, ...rest }
}

type ExaState = Extract<WebSearchProviderCardState, { provider: 'exa' }>
type BraveState = Extract<WebSearchProviderCardState, { provider: 'brave' }>

function exaState(overrides: Partial<ExaState> = {}): ExaState {
  return {
    ...settled,
    provider: 'exa',
    switchAvailable: true,
    switchBlocked: overrides.invalid === true || overrides.failed === true,
    enabled: true,
    apiKey: field(''),
    apiKeyConfigured: false,
    apiKeyWritable: true,
    searchType: field('auto'),
    numResults: field(''),
    ...overrides,
  }
}

function braveState(overrides: Partial<BraveState> = {}): BraveState {
  return {
    ...settled,
    provider: 'brave',
    switchAvailable: true,
    switchBlocked: overrides.invalid === true || overrides.failed === true,
    enabled: false,
    apiKey: field(''),
    apiKeyConfigured: false,
    apiKeyWritable: true,
    maxResults: field('8'),
    safesearch: field('moderate'),
    ...overrides,
  }
}

function cardActions() {
  return { edit: vi.fn(), resetField: vi.fn(), setEnabled: vi.fn(), save: vi.fn(), discard: vi.fn() }
}

function renderCard(state: WebSearchProviderCardState) {
  const store = createSnapshotStore<WebSearchProviderCardState>(state)
  const actions = cardActions()
  const props = {
    ...actions, view: 'page', t, useWebSearchProviderCard: bindSnapshotSelector(store),
  } as WebSearchProviderCardProps
  render(<WebSearchProviderCard {...props} />)
  return actions
}

describe('WebSearchProviderCard summary', () => {
  it('renders the provider one-liner without controls', () => {
    const store = createSnapshotStore<WebSearchProviderCardState>(exaState())
    const props = {
      ...cardActions(), view: 'summary', t, useWebSearchProviderCard: bindSnapshotSelector(store),
    } as WebSearchProviderCardProps
    render(<WebSearchProviderCard {...props} />)

    expect(document.body.textContent).toBe(en.descriptionExa)
    expect(screen.queryByLabelText(en.apiKey)).toBeNull()
  })
})

describe('WebSearchProviderCard switch and key', () => {
  it('shows the provider switch state and stages the other provider', () => {
    const actions = renderCard(braveState({ enabled: false }))

    const toggle = screen.getByRole('switch', { name: en.enabledBrave })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(toggle)

    expect(actions.setEnabled).toHaveBeenCalledWith(true)
    expect(actions.save).not.toHaveBeenCalled()
    expect(screen.getByText(en.switchHint)).toBeTruthy()
  })

  it('disables the switch but keeps the key control when the web namespace is not served', () => {
    const actions = renderCard(exaState({ switchAvailable: false, enabled: false }))

    const toggle = screen.getByRole('switch', { name: en.enabledExa })
    expect(toggle).toHaveProperty('disabled', true)
    expect(toggle.getAttribute('title')).toBe(en.switchUnavailable)
    expect(screen.getByText(en.switchUnavailable)).toBeTruthy()
    const key = screen.getByLabelText(en.apiKey)
    expect(key).toHaveProperty('disabled', false)
    fireEvent.change(key, { target: { value: 'ex-secret' } })
    expect(actions.edit).toHaveBeenCalledWith('apiKey', 'ex-secret')
  })

  it('reports whether a key is configured without ever showing one', () => {
    renderCard(exaState({ apiKeyConfigured: true }))

    expect(screen.getByText(en.apiKeySet)).toBeTruthy()
    expect(screen.getByLabelText(en.apiKey)).toHaveProperty('type', 'password')
  })

  it('keeps the key usable while the settings document is read-only', () => {
    const actions = renderCard(braveState({ writable: false }))

    const key = screen.getByLabelText(en.apiKey)
    expect(key).toHaveProperty('disabled', false)
    expect(screen.getByLabelText(en.maxResults)).toHaveProperty('disabled', true)
    expect(screen.getByRole('switch', { name: en.enabledBrave })).toHaveProperty('disabled', true)
    fireEvent.change(key, { target: { value: 'br-secret' } })
    expect(actions.edit).toHaveBeenCalledWith('apiKey', 'br-secret')
  })

  it('disables the key control when the reference itself is not writable', () => {
    renderCard(braveState({ apiKeyConfigured: true, apiKeyWritable: false }))

    expect(screen.getByLabelText(en.apiKey)).toHaveProperty('disabled', true)
    expect(screen.getByLabelText(en.maxResults)).toHaveProperty('disabled', false)
  })

  it.each([{ invalid: true }, { failed: true }, { saving: true }])(
    'locks the switch while an invalid or unsaved state stands: %j',
    (state) => {
      renderCard(exaState(state))
      expect(screen.getByRole('switch', { name: en.enabledExa })).toHaveProperty('disabled', true)
      expect(screen.getByLabelText(en.numResults)).toBeTruthy()
    },
  )
})

describe('WebSearchProviderCard Exa fields', () => {
  it('stages the retrieval mode and the result count with their resets', () => {
    const actions = renderCard(exaState({
      searchType: field('keyword', { overridden: true }),
      numResults: field('5', { overridden: true }),
    }))

    const select = screen.getByLabelText(en.searchType)
    expect(select).toHaveProperty('value', 'keyword')
    expect(screen.getByRole('option', { name: en.searchTypeNeural })).toBeTruthy()
    fireEvent.change(select, { target: { value: 'neural' } })
    fireEvent.change(screen.getByLabelText(en.numResults), { target: { value: '9' } })

    const resets = screen.getAllByRole('button', { name: en.reset })
    expect(resets).toHaveLength(2)
    for (const reset of resets) fireEvent.click(reset)

    expect(actions.edit.mock.calls).toEqual([['searchType', 'neural'], ['numResults', '9']])
    expect(actions.resetField.mock.calls).toEqual([['searchType'], ['numResults']])
  })

  it('shows the provider defaults while nothing is stored', () => {
    renderCard(exaState())

    expect(screen.getByLabelText(en.searchType)).toHaveProperty('value', 'auto')
    expect(screen.getByLabelText(en.numResults)).toHaveProperty('value', '')
    expect(screen.queryByRole('button', { name: en.reset })).toBeNull()
    expect(zh.searchTypeKeyword).toBe('关键词')
  })

  it('explains the result bound and blocks saving an invalid draft', () => {
    renderCard(exaState({ numResults: field('0', { invalid: true }), invalid: true, dirty: true }))

    expect(screen.getByText(en.invalidNumResults)).toBeTruthy()
    expect(screen.getByLabelText(en.numResults).getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByRole('button', { name: en.save })).toHaveProperty('disabled', true)
  })
})

describe('WebSearchProviderCard Brave fields', () => {
  it('stages the result bound and safe search', () => {
    const actions = renderCard(braveState())

    fireEvent.change(screen.getByLabelText(en.maxResults), { target: { value: '12' } })
    const select = screen.getByLabelText(en.safesearch)
    expect(select).toHaveProperty('value', 'moderate')
    expect(screen.getByRole('option', { name: en.safesearchOff })).toBeTruthy()
    fireEvent.change(select, { target: { value: 'strict' } })

    expect(actions.edit.mock.calls).toEqual([['maxResults', '12'], ['safesearch', 'strict']])
    expect(zh.safesearchStrict).toBe('严格')
  })

  it('blocks saving a result bound outside 1 to 20', () => {
    renderCard(braveState({ maxResults: field('21', { invalid: true }), invalid: true, dirty: true }))

    expect(screen.getByText(en.invalidMaxResults)).toBeTruthy()
    expect(screen.getByLabelText(en.maxResults).getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByRole('button', { name: en.save })).toHaveProperty('disabled', true)
  })
})
