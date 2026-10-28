/** Purpose-routing rows inside the shared Subagent settings card. */

import { useId } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SubagentSettingsLocaleKey } from './locales.ts'
import type {
  GuidanceFieldState,
  GuidanceSlot,
  PurposeRouteEditorState,
  PurposeRouteField,
  PurposeRouteMove,
  PurposeRouteSlot,
  SubagentPurposeRoutesCardFace,
  SubagentPurposeRoutesCardState,
} from './subagent-purpose-routes-card-controller.ts'
import css from './SubagentPurposeRoutesFields.module.css'
import { catalogNoticeProps, ModelCatalogStatus } from './settings-catalog.tsx'

/** Plain purpose-route state and callbacks supplied by the owning card. */
export type SubagentPurposeRoutesFieldsProps = PropsLocale<'settings.subagent'>
  & Pick<SubagentPurposeRoutesCardFace, 'editRoute' | 'addReviewer' | 'removeReviewer' | 'moveReviewer' | 'retryCatalog' | 'editGuidance' | 'resetGuidance'>
  & { state: SubagentPurposeRoutesCardState }

type Translate = (key: SubagentSettingsLocaleKey) => string

function slotLabel(t: Translate, slot: PurposeRouteSlot): string {
  switch (slot) {
    case 'light': return t('purposeRoutes.slot.light.label')
    case 'medium': return t('purposeRoutes.slot.medium.label')
    case 'deep': return t('purposeRoutes.slot.deep.label')
    case 'review': return t('purposeRoutes.slot.review.label')
    case 'writing': return t('purposeRoutes.slot.writing.label')
    case 'default': return t('purposeRoutes.slot.default.label')
  }
}

function guidanceError(t: Translate, field: GuidanceFieldState): string | undefined {
  if (field.issue === 'empty') return t('purposeRoutes.errors.guidanceEmpty')
  if (field.issue === 'long') return t('purposeRoutes.errors.guidanceLong')
  if (field.issue === 'identifier') return `${t('purposeRoutes.errors.guidanceIdentifier')} ${field.identifier ?? ''}`
  return undefined
}

function GuidanceEditor(props: {
  t: Translate
  field: GuidanceFieldState
  label: string
  hint: string
  disabled: boolean
  editGuidance: (slot: GuidanceSlot, value: string) => void
}) {
  const id = useId()
  const error = guidanceError(props.t, props.field)
  const errorId = `${id}-error`
  return (
    <div className={css.field}>
      <label htmlFor={id}>{props.label}</label>
      <textarea
        id={id}
        rows={Math.min(6, Math.max(2, props.field.text.split('\n').length))}
        value={props.field.text}
        disabled={props.disabled}
        aria-invalid={props.field.issue !== undefined || undefined}
        aria-describedby={error === undefined ? undefined : errorId}
        onChange={(event) => { props.editGuidance(props.field.slot, event.target.value) }}
      />
      <span className={css.hint}>{props.hint}</span>
      {error === undefined ? null : <p id={errorId} className={css.invalid} role="alert">{error}</p>}
    </div>
  )
}

function slotHint(t: Translate, slot: PurposeRouteSlot): string {
  switch (slot) {
    case 'light': return t('purposeRoutes.slot.light.hint')
    case 'medium': return t('purposeRoutes.slot.medium.hint')
    case 'deep': return t('purposeRoutes.slot.deep.hint')
    case 'review': return t('purposeRoutes.slot.review.hint')
    case 'writing': return t('purposeRoutes.slot.writing.hint')
    case 'default': return t('purposeRoutes.slot.default.hint')
  }
}

function RouteEditor(props: {
  t: Translate
  slot: PurposeRouteSlot
  index: number
  route: PurposeRouteEditorState
  fanOut: boolean
  routeCount: number
  disabled: boolean
  editRoute: SubagentPurposeRoutesCardFace['editRoute']
  removeReviewer: SubagentPurposeRoutesCardFace['removeReviewer']
  moveReviewer: SubagentPurposeRoutesCardFace['moveReviewer']
}) {
  const { t, route, slot, index } = props
  const id = useId()
  const missingId = `${id}-missing`
  const effortId = `${id}-effort`
  const describedBy = [
    route.missing ? missingId : undefined,
    route.effortUnsupported ? effortId : undefined,
  ].filter(item => item !== undefined).join(' ')
  const change = (field: PurposeRouteField) => (event: { target: { value: string } }) => {
    props.editRoute(slot, index, field, event.target.value)
  }
  const move = (direction: PurposeRouteMove) => () => { props.moveReviewer(index, direction) }
  return (
    <div className={css.route}>
      <div className={css.fields}>
        <label className={css.field}>
          {t('purposeRoutes.provider')}
          <select
            id={`${id}-provider`}
            value={route.provider}
            disabled={props.disabled}
            aria-invalid={route.missing || undefined}
            aria-describedby={describedBy === '' ? undefined : describedBy}
            onChange={change('provider')}
          >
            <option value="">{t('purposeRoutes.chooseProvider')}</option>
            {route.providers.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
        </label>
        <label className={css.field}>
          {t('purposeRoutes.model')}
          <select id={`${id}-model`} value={route.model} disabled={props.disabled} aria-invalid={route.missing || undefined} onChange={change('model')}>
            <option value="">{t('purposeRoutes.chooseModel')}</option>
            {route.models.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
        </label>
        <label className={css.field}>
          {t('purposeRoutes.effort')}
          <select
            id={`${id}-effort-select`}
            value={route.reasoningEffort}
            disabled={props.disabled}
            aria-invalid={route.missing || route.effortUnsupported || undefined}
            onChange={change('effort')}
          >
            <option value="">{t('purposeRoutes.chooseEffort')}</option>
            {route.efforts.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
        </label>
      </div>
      {route.missing ? <p id={missingId} className={css.invalid} role="alert">{t('purposeRoutes.errors.missingRoute')}</p> : null}
      {route.effortUnsupported ? <p id={effortId} className={css.invalid} role="alert">{t('purposeRoutes.errors.effortUnsupported')}</p> : null}
      {!route.available && !route.missing
        ? <p className={css.warning} role="status">{t('purposeRoutes.warnings.providerUnavailable')}</p>
        : null}
      {props.fanOut
        ? (
          <div className={css.actions}>
            <button type="button" disabled={props.disabled || index === 0} onClick={move('earlier')}>{t('purposeRoutes.moveEarlier')}</button>
            <button type="button" disabled={props.disabled || index >= props.routeCount - 1} onClick={move('later')}>{t('purposeRoutes.moveLater')}</button>
            <button type="button" disabled={props.disabled || props.routeCount <= 1} onClick={() => { props.removeReviewer(index) }}>{t('purposeRoutes.removeReviewer')}</button>
          </div>
        )
        : null}
    </div>
  )
}

/**
 * Render the purpose table, or the empty state when the Host has none.
 * @param props - locale copy, the section snapshot, and its edit actions.
 * @returns the purpose rows inside the shared card.
 */
export function SubagentPurposeRoutesFields(props: SubagentPurposeRoutesFieldsProps) {
  const { t, state } = props
  const headingId = useId()
  const disabled = !state.writable || state.saving
  return (
    <div className={css.root}>
      <p className={css.hint}>{t('purposeRoutes.description')}</p>
      {state.configured
        ? <p className={css.hint}>{t('purposeRoutes.appliesNextDelegation')}</p>
        : <p className={css.notice} role="status">{t('purposeRoutes.notConfigured')}</p>}
      {state.configured
        ? (
          <>
            <ModelCatalogStatus {...catalogNoticeProps(t, state, props.retryCatalog, css.notice, css.catalogError)} />
            {state.catalogPartial ? <p className={css.notice}>{t('subagentModelSelectionPartial')}</p> : null}
            <div className={css.rows}>
              {state.rows.map(row => (
                <section key={row.slot} className={css.row} aria-labelledby={`${headingId}-${row.slot}`}>
                  <div className={css.purpose}>
                    <h4 className={css.label} id={`${headingId}-${row.slot}`}>{slotLabel(t, row.slot)}</h4>
                    <GuidanceEditor
                      t={t}
                      field={row.guidance}
                      label={t('purposeRoutes.guidance.sentence')}
                      hint={slotHint(t, row.slot)}
                      disabled={disabled}
                      editGuidance={props.editGuidance}
                    />
                  </div>
                  <div className={css.routes} role="group" aria-label={t('purposeRoutes.primary')}>
                    {row.empty ? <p className={css.notice} role="status">{t('purposeRoutes.emptySlot')}</p> : null}
                    {row.routes.map((route, index) => (
                      <RouteEditor
                        key={route.id}
                        t={t}
                        slot={row.slot}
                        index={index}
                        route={route}
                        fanOut={row.fanOut}
                        routeCount={row.fanOut ? row.routes.length : 1}
                        disabled={disabled}
                        editRoute={props.editRoute}
                        removeReviewer={props.removeReviewer}
                        moveReviewer={props.moveReviewer}
                      />
                    ))}
                    {row.duplicate ? <p className={css.invalid} role="alert">{t('purposeRoutes.errors.duplicateRoute')}</p> : null}
                    {row.extra ? <p className={css.invalid} role="alert">{t('purposeRoutes.errors.extraRoute')}</p> : null}
                    {row.fanOut
                      ? (
                        <div className={css.actions}>
                          <button type="button" disabled={disabled} onClick={props.addReviewer}>{t('purposeRoutes.addReviewer')}</button>
                        </div>
                      )
                      : null}
                  </div>
                </section>
              ))}
            </div>
            <GuidanceEditor
              t={t}
              field={state.splitting}
              label={t('purposeRoutes.guidance.splitting')}
              hint={t('purposeRoutes.guidance.splittingHint')}
              disabled={disabled}
              editGuidance={props.editGuidance}
            />
            <p className={css.hint}>{state.guidanceBuiltin ? t('purposeRoutes.guidance.builtin') : t('purposeRoutes.guidance.hint')}</p>
            <div className={css.actions}>
              <button type="button" disabled={disabled || state.guidanceBuiltin} onClick={props.resetGuidance}>{t('purposeRoutes.guidance.reset')}</button>
            </div>
          </>
        )
        : null}
      {state.conflicted ? <p className={css.conflict} role="status">{t('subagentModelSelectionConflict')}</p> : null}
    </div>
  )
}
