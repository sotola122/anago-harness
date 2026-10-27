/** Shared catalog-load and revision-save steps for the two subagent settings sections. */

import type { SubagentSettingsLocaleKey } from './locales.ts'

type CatalogStatus = 'idle' | 'loading' | 'ready' | 'error'

interface ReadyCatalog<Group> {
  readonly ok: true
  readonly value: { readonly groups: readonly Group[]; readonly failures: readonly unknown[] }
}

interface FailedCatalog {
  readonly ok: false
}

/**
 * Load the session model catalog into one section, ignoring a superseded request.
 * @param input - the section's catalog generation and the Host request.
 * @returns when the request has been applied or dropped.
 */
export async function loadSessionModelCatalog<Group>(input: {
  disposed: boolean
  status: CatalogStatus
  generation: number
  readGeneration: () => number
  publish: () => void
  markLoading: () => void
  fetch: () => Promise<ReadyCatalog<Group> | FailedCatalog>
  applyReady: (groups: readonly Group[], partial: boolean) => void
  applyError: () => void
}): Promise<void> {
  if (input.disposed || input.status === 'loading') return
  const generation = input.generation
  input.markLoading()
  input.publish()
  const response = await input.fetch()
  if (generation !== input.readGeneration()) return
  if (response.ok) input.applyReady(response.value.groups, response.value.failures.length > 0)
  else input.applyError()
  input.publish()
}

/**
 * Start a settings save, or record a conflict when the draft revision is stale.
 * @param input - the draft's staleness and the section's save generation.
 * @returns the generation to compare after the mutation, or `undefined` when the save did not start.
 */
export function beginRevisionSave(input: {
  stale: boolean
  saveGeneration: number
  publish: () => void
  markConflict: () => void
  markSaving: () => void
}): number | undefined {
  if (input.stale) {
    input.markConflict()
    input.publish()
    return undefined
  }
  const generation = input.saveGeneration
  input.markSaving()
  input.publish()
  return generation
}

/**
 * Build the shared catalog-notice props for one settings section.
 * @param t - locale function for the subagent settings dictionary.
 * @param state - the section snapshot's catalog status and save flag.
 * @param onRetry - reloads the catalog after an error.
 * @param noticeClass - loading-notice class from the section stylesheet.
 * @param errorClass - error-row class from the section stylesheet.
 * @returns props for {@link ModelCatalogStatus}.
 */
export function catalogNoticeProps(
  t: (key: SubagentSettingsLocaleKey) => string,
  state: { catalogStatus: CatalogStatus; saving: boolean },
  onRetry: () => void,
  noticeClass: string | undefined,
  errorClass: string | undefined,
) {
  return { t, status: state.catalogStatus, saving: state.saving, onRetry, noticeClass, errorClass }
}

/**
 * Render the shared loading and error notices for a session model catalog.
 * @param props - locale copy, catalog status, and the retry action.
 * @returns the notice elements, or nothing while the catalog is idle or ready.
 */
export function ModelCatalogStatus(props: {
  t: (key: SubagentSettingsLocaleKey) => string
  status: CatalogStatus
  saving: boolean
  onRetry: () => void
  noticeClass: string | undefined
  errorClass: string | undefined
}) {
  const { t, status } = props
  return (
    <>
      {status === 'loading'
        ? <p className={props.noticeClass} role="status">{t('subagentModelSelectionLoading')}</p>
        : null}
      {status === 'error'
        ? (
          <div className={props.errorClass} role="alert">
            <span>{t('subagentModelSelectionLoadFailed')}</span>
            <button type="button" disabled={props.saving} onClick={props.onRetry}>
              {t('subagentModelSelectionRetry')}
            </button>
          </div>
        )
        : null}
    </>
  )
}
