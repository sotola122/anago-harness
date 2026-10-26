import { describe, expect, it, vi } from 'vitest'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import { RemoteError, stubConfigForm, type StubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { SubagentLimitsCardController, type SubagentLimitsSettings } from '../src/client/subagent-limits-card-controller.ts'
import { subagentCardFace, subagentCardShell } from '../src/client/subagent-card-controller.ts'
import {
  SubagentModelSelectionCardController,
  subagentModelCandidates,
  type SubagentModelSelectionSettings,
} from '../src/client/subagent-model-selection-card-controller.ts'
import {
  SubagentPurposeRoutesCardController,
  purposeRouteTableFromValue,
  samePurposeRouteTable,
  type PurposeRouteTableDraft,
  type PurposeRoutesSettings,
} from '../src/client/subagent-purpose-routes-card-controller.ts'

/** Make the stub behave like a Host that accepts every write. */
function acceptWrites<T>(host: StubConfigForm<T>): void {
  const section = (): Record<string, unknown> => ({ ...host.scope.getSnapshot().value as object })
  const layer = (): Record<string, unknown> => ({ ...host.scope.getSnapshot().user as object })
  host.set.mockImplementation((field: string, value: unknown) => {
    host.publish({ value: { ...section(), [field]: value } as T, user: { ...layer(), [field]: value } })
  })
  host.mutate.mockImplementation((ops: readonly SettingsPathOpView[]) => {
    const value = { ...section() }
    const user = { ...layer() }
    for (const op of ops) {
      const field = op.path[0]!
      if (op.op === 'set') {
        value[field] = op.value
        user[field] = op.value
      } else {
        Reflect.deleteProperty(user, field)
        value[field] = (host.scope.getSnapshot().base as Record<string, unknown> | undefined)?.[field]
      }
    }
    host.publish({ value: value as T, user })
    return Promise.resolve(true)
  })
  host.unset.mockImplementation((field: string) => {
    const user = Object.fromEntries(Object.entries(layer()).filter(([key]) => key !== field))
    const base = host.scope.getSnapshot().base as Record<string, unknown> | undefined
    host.publish({ value: { ...section(), [field]: base?.[field] } as T, user })
  })
}

/** The card plugin's context, scripted down to the namespaces a card reaches. */
function ctxWith(namespaces: object) {
  return { remote: namespaces } as never
}

function modelsApi(options: {
  groups?: readonly {
    id: string
    name: string
    models: readonly {
      id: string
      name: string
      reasoning?: { efforts: readonly { id: string; name: string }[]; defaultEffort?: string }
    }[]
  }[]
  failures?: readonly { id: string; name: string; message: string }[]
  error?: string
} = {}) {
  const models = vi.fn(() => Promise.resolve({
    ...(options.error === undefined
      ? { ok: true as const, value: { groups: options.groups ?? [], failures: options.failures ?? [] } }
      : { ok: false as const, error: new RemoteError('gateway/internal', options.error, {}) }),
  }))
  return { ctx: ctxWith({ session: { modelCatalog: models } }), models }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept
    reject = fail
  })
  return { promise, resolve, reject }
}

describe('SubagentModelSelectionCardController', () => {
  it('joins stored routes with the live catalog without dropping unavailable choices', () => {
    const candidates = subagentModelCandidates(
      [{ id: 'alpha', name: 'Alpha API', models: [{ id: 'fast', name: 'Fast' }] }],
      [{ provider: 'legacy', model: 'old' }],
      new Set(['legacy\0old']),
    )

    expect(candidates).toEqual([
      {
        key: 'alpha\0fast', provider: 'alpha', model: 'fast', providerName: 'Alpha API',
        modelName: 'Fast', available: true, selected: false,
      },
      {
        key: 'legacy\0old', provider: 'legacy', model: 'old', providerName: 'legacy',
        modelName: 'old', available: false, selected: true,
      },
    ])
  })

  it('loads adapter models and saves the switch and routes atomically', async () => {
    const host = stubConfigForm<SubagentModelSelectionSettings>()
    acceptWrites(host)
    const models = modelsApi({
      groups: [{ id: 'alpha', name: 'Alpha API', models: [{ id: 'fast', name: 'Fast' }] }],
    })
    const controller = new SubagentModelSelectionCardController(host.scope, models.ctx)
    host.publish({
      status: 'ready', writable: true, revision: 3,
      value: { enabled: false, allowedModels: [] }, user: {},
    })
    const face = controller.inject()

    expect(face.hooks.subagentModelSelectionCard.getSnapshot().enabled).toBe(false)
    face.toggleEnabled()
    await vi.waitFor(() => {
      expect(face.hooks.subagentModelSelectionCard.getSnapshot().candidates).toHaveLength(1)
    })
    face.toggleModel('alpha\0fast')
    face.save()
    await vi.waitFor(() => {
      expect(host.mutate).toHaveBeenCalledWith([
        { op: 'set', path: ['enabled'], value: true },
        { op: 'set', path: ['allowedModels'], value: [{ provider: 'alpha', model: 'fast' }] },
      ], 3)
    })

    expect(face.hooks.subagentModelSelectionCard.getSnapshot()).toMatchObject({
      enabled: true,
      dirty: false,
      saving: false,
      failed: false,
    })
  })

  it('starts an empty draft when a ready test scope has no decoded value', () => {
    const host = stubConfigForm<SubagentModelSelectionSettings>()
    const controller = new SubagentModelSelectionCardController(host.scope, modelsApi().ctx)
    host.publish({ status: 'ready', writable: true, revision: 0, value: undefined })
    const face = controller.inject()

    face.toggleEnabled()

    expect(face.hooks.subagentModelSelectionCard.getSnapshot()).toMatchObject({
      enabled: true, dirty: true, invalid: true,
    })
  })

  it('keeps the Host value and reports a rejected write', async () => {
    const host = stubConfigForm<SubagentModelSelectionSettings>()
    const models = modelsApi({
      groups: [{ id: 'alpha', name: 'Alpha API', models: [{ id: 'fast', name: 'Fast' }] }],
    })
    const controller = new SubagentModelSelectionCardController(host.scope, models.ctx)
    host.publish({ status: 'ready', writable: true, value: { enabled: false, allowedModels: [] }, user: {} })
    const face = controller.inject()

    face.toggleEnabled()
    await vi.waitFor(() => {
      expect(face.hooks.subagentModelSelectionCard.getSnapshot().candidates).toHaveLength(1)
    })
    face.toggleModel('alpha\0fast')
    face.save()
    await vi.waitFor(() => {
      expect(face.hooks.subagentModelSelectionCard.getSnapshot().failed).toBe(true)
    })

    expect(face.hooks.subagentModelSelectionCard.getSnapshot()).toMatchObject({
      enabled: true,
      dirty: true,
      saving: false,
    })
  })

  it('loads stored routes, stages removal and disablement, and discards both', async () => {
    const host = stubConfigForm<SubagentModelSelectionSettings>()
    const models = modelsApi({
      groups: [{ id: 'alpha', name: 'Alpha API', models: [{ id: 'fast', name: 'Fast' }] }],
      failures: [{ id: 'beta', name: 'Beta', message: 'offline' }],
    })
    const controller = new SubagentModelSelectionCardController(host.scope, models.ctx)
    host.publish({
      status: 'ready', writable: true, revision: 5,
      value: { enabled: true, allowedModels: [{ provider: 'alpha', model: 'fast' }] }, user: {},
    })
    const face = controller.inject()
    const state = () => face.hooks.subagentModelSelectionCard.getSnapshot()
    await vi.waitFor(() => { expect(state().catalogStatus).toBe('ready') })
    expect(state().catalogPartial).toBe(true)

    face.toggleModel('missing')
    expect(state().dirty).toBe(false)
    face.toggleModel('alpha\0fast')
    expect(state()).toMatchObject({ dirty: true, invalid: true })
    face.discard()
    expect(state()).toMatchObject({ dirty: false, invalid: false, enabled: true })

    face.toggleEnabled()
    expect(state()).toMatchObject({ dirty: true, enabled: false })
    face.toggleEnabled()
    expect(state()).toMatchObject({ dirty: false, enabled: true })
  })

  it('retains selected routes when disabling and loads an already-ready enabled card', async () => {
    const host = stubConfigForm<SubagentModelSelectionSettings>()
    acceptWrites(host)
    host.publish({
      status: 'ready', writable: true, revision: 5,
      value: { enabled: true, allowedModels: [{ provider: 'alpha', model: 'fast' }] }, user: {},
    })
    const models = modelsApi({
      groups: [{ id: 'alpha', name: 'Alpha API', models: [{ id: 'fast', name: 'Fast' }] }],
    })
    const controller = new SubagentModelSelectionCardController(host.scope, models.ctx)
    const face = controller.inject()
    await vi.waitFor(() => { expect(models.models).toHaveBeenCalledOnce() })

    face.toggleEnabled()
    face.save()
    await vi.waitFor(() => {
      expect(host.mutate).toHaveBeenCalledWith([
        { op: 'set', path: ['enabled'], value: false },
        { op: 'set', path: ['allowedModels'], value: [{ provider: 'alpha', model: 'fast' }] },
      ], 5)
    })
    expect(face.hooks.subagentModelSelectionCard.getSnapshot()).toMatchObject({
      enabled: false, dirty: false,
    })
  })

  it('reports a directory error and retries it', async () => {
    const host = stubConfigForm<SubagentModelSelectionSettings>()
    const models = modelsApi({ error: 'offline' })
    const controller = new SubagentModelSelectionCardController(host.scope, models.ctx)
    host.publish({ status: 'ready', writable: true, value: { enabled: false, allowedModels: [] }, user: {} })
    const face = controller.inject()
    const state = () => face.hooks.subagentModelSelectionCard.getSnapshot()

    face.toggleEnabled()
    await vi.waitFor(() => { expect(state().catalogStatus).toBe('error') })
    face.retryCatalog()
    await vi.waitFor(() => { expect(models.models).toHaveBeenCalledTimes(2) })
  })

  it('rejects a draft after the Host revision changes', async () => {
    const host = stubConfigForm<SubagentModelSelectionSettings>()
    const models = modelsApi({
      groups: [{ id: 'alpha', name: 'Alpha API', models: [{ id: 'fast', name: 'Fast' }] }],
    })
    const controller = new SubagentModelSelectionCardController(host.scope, models.ctx)
    host.publish({
      status: 'ready', writable: true, revision: 4,
      value: { enabled: false, allowedModels: [] }, user: {},
    })
    const face = controller.inject()
    face.toggleEnabled()
    await vi.waitFor(() => {
      expect(face.hooks.subagentModelSelectionCard.getSnapshot().candidates).toHaveLength(1)
    })
    face.toggleModel('alpha\0fast')

    host.publish({
      revision: 5,
      value: { enabled: true, allowedModels: [{ provider: 'other', model: 'new' }] },
    })
    expect(face.hooks.subagentModelSelectionCard.getSnapshot()).toMatchObject({
      conflicted: true, failed: false, dirty: true,
    })
    face.save()
    await Promise.resolve()

    expect(host.mutate).not.toHaveBeenCalled()
    face.discard()
    expect(face.hooks.subagentModelSelectionCard.getSnapshot()).toMatchObject({
      conflicted: false, failed: false, dirty: false, enabled: true,
    })
  })

  it('settles a draft when a newer Host revision already contains it', async () => {
    const host = stubConfigForm<SubagentModelSelectionSettings>()
    const models = modelsApi({
      groups: [{ id: 'alpha', name: 'Alpha', models: [{ id: 'fast', name: 'Fast' }] }],
    })
    const controller = new SubagentModelSelectionCardController(host.scope, models.ctx)
    host.publish({
      status: 'ready', writable: true, revision: 4,
      value: { enabled: false, allowedModels: [] }, user: {},
    })
    const face = controller.inject()
    face.toggleEnabled()
    await vi.waitFor(() => { expect(face.hooks.subagentModelSelectionCard.getSnapshot().candidates).toHaveLength(1) })
    face.toggleModel('alpha\0fast')

    host.publish({
      revision: 5,
      value: { enabled: true, allowedModels: [{ provider: 'alpha', model: 'fast' }] },
    })

    expect(face.hooks.subagentModelSelectionCard.getSnapshot()).toMatchObject({
      conflicted: false, dirty: false, enabled: true,
    })
  })

  it('retains unsaved routes across a catalog refresh', async () => {
    const host = stubConfigForm<SubagentModelSelectionSettings>()
    acceptWrites(host)
    host.publish({
      status: 'ready', writable: true, revision: 2,
      value: { enabled: false, allowedModels: [] }, user: {},
    })
    const refreshed = deferred<never>()
    const models = vi.fn()
      .mockResolvedValueOnce({
        ok: true, value: {
          groups: [{ id: 'alpha', name: 'Alpha', models: [{ id: 'fast', name: 'Fast' }] }],
          failures: [],
        },
      })
      .mockImplementationOnce(() => refreshed.promise)
    const controller = new SubagentModelSelectionCardController(
      host.scope, ctxWith({ session: { modelCatalog: models } }),
    )
    const face = controller.inject()
    const state = () => face.hooks.subagentModelSelectionCard.getSnapshot()
    face.toggleEnabled()
    await vi.waitFor(() => { expect(state().candidates).toHaveLength(1) })
    face.toggleModel('alpha\0fast')

    controller.refreshCatalog()
    expect(state()).toMatchObject({
      catalogStatus: 'loading',
      candidates: [expect.objectContaining({ key: 'alpha\0fast', selected: true })],
    })
    refreshed.resolve({
      ok: true, value: { groups: [], failures: [] },
    } as never)
    await vi.waitFor(() => { expect(state().catalogStatus).toBe('ready') })
    expect(state().candidates).toEqual([
      expect.objectContaining({ key: 'alpha\0fast', available: false, selected: true }),
    ])

    face.save()
    await vi.waitFor(() => {
      expect(host.mutate).toHaveBeenCalledWith([
        { op: 'set', path: ['enabled'], value: true },
        { op: 'set', path: ['allowedModels'], value: [{ provider: 'alpha', model: 'fast' }] },
      ], 2)
    })
  })

  it('drops a draft when the connection generation changes', async () => {
    const host = stubConfigForm<SubagentModelSelectionSettings>()
    const models = modelsApi({
      groups: [{ id: 'alpha', name: 'Alpha', models: [{ id: 'fast', name: 'Fast' }] }],
    })
    host.publish({
      status: 'ready', writable: true, revision: 4,
      value: { enabled: false, allowedModels: [] }, user: {},
    })
    const controller = new SubagentModelSelectionCardController(host.scope, models.ctx)
    const face = controller.inject()
    face.toggleEnabled()
    await vi.waitFor(() => { expect(face.hooks.subagentModelSelectionCard.getSnapshot().candidates).toHaveLength(1) })
    face.toggleModel('alpha\0fast')

    controller.resetConnection()
    host.publish({
      revision: 4,
      value: { enabled: true, allowedModels: [{ provider: 'other', model: 'new' }] },
    })

    expect(face.hooks.subagentModelSelectionCard.getSnapshot()).toMatchObject({
      conflicted: false, dirty: false, enabled: true,
    })
    face.save()
    await Promise.resolve()
    expect(host.mutate).not.toHaveBeenCalled()
  })

  it('reloads the model catalog after invalidation', async () => {
    const host = stubConfigForm<SubagentModelSelectionSettings>()
    host.publish({
      status: 'ready', writable: true, revision: 1,
      value: { enabled: true, allowedModels: [] }, user: {},
    })
    const models = vi.fn()
      .mockResolvedValueOnce({
        ok: true, value: {
          groups: [{ id: 'alpha', name: 'Alpha', models: [{ id: 'fast', name: 'Fast' }] }],
          failures: [],
        },
      })
      .mockResolvedValueOnce({
        ok: true, value: {
          groups: [{ id: 'beta', name: 'Beta', models: [{ id: 'new', name: 'New' }] }],
          failures: [],
        },
      })
    const controller = new SubagentModelSelectionCardController(
      host.scope, ctxWith({ session: { modelCatalog: models } }),
    )
    const state = () => controller.inject().hooks.subagentModelSelectionCard.getSnapshot()
    await vi.waitFor(() => { expect(state().candidates[0]?.provider).toBe('alpha') })

    controller.refreshCatalog()

    await vi.waitFor(() => { expect(state().candidates[0]?.provider).toBe('beta') })
    expect(models).toHaveBeenCalledTimes(2)
  })

  it('suppresses duplicate actions and late save settlements', async () => {
    const host = stubConfigForm<SubagentModelSelectionSettings>()
    const catalog = modelsApi({
      groups: [{ id: 'alpha', name: 'Alpha API', models: [{ id: 'fast', name: 'Fast' }] }],
    })
    const write = deferred<undefined>()
    const mutate = vi.fn(async (ops: readonly SettingsPathOpView[]) => {
      await write.promise
      const enabled = ops.find(op => op.path[0] === 'enabled')
      const allowedModels = ops.find(op => op.path[0] === 'allowedModels')
      host.publish({ value: {
        enabled: enabled?.op === 'set' ? enabled.value as boolean : false,
        allowedModels: allowedModels?.op === 'set' ? allowedModels.value as never[] : [],
      } })
      return true
    })
    const controller = new SubagentModelSelectionCardController({ ...host.scope, mutate }, catalog.ctx)
    const face = controller.inject()

    face.save()
    face.toggleModel('alpha\0fast')
    host.publish({ status: 'ready', writable: true, value: { enabled: false, allowedModels: [] }, user: {} })
    face.save()
    face.toggleEnabled()
    await vi.waitFor(() => { expect(face.hooks.subagentModelSelectionCard.getSnapshot().catalogStatus).toBe('ready') })
    face.save()
    face.toggleModel('alpha\0fast')
    face.save()
    expect(face.hooks.subagentModelSelectionCard.getSnapshot().saving).toBe(true)
    face.toggleEnabled()
    face.toggleModel('alpha\0fast')
    face.save()
    face.discard()
    controller.dispose()
    write.resolve(undefined)
    await write.promise
    expect(mutate).toHaveBeenCalledOnce()
  })

  it('suppresses duplicate directory loads and late settlements', async () => {
    const host = stubConfigForm<SubagentModelSelectionSettings>()
    host.publish({ status: 'ready', writable: true, value: { enabled: false, allowedModels: [] }, user: {} })

    const pending = deferred<never>()
    const models = vi.fn(() => pending.promise)
    const controller = new SubagentModelSelectionCardController(host.scope, ctxWith({ session: { modelCatalog: models } }))
    const face = controller.inject()
    face.toggleEnabled()
    face.retryCatalog()
    expect(models).toHaveBeenCalledOnce()
    controller.dispose()
    pending.resolve({ ok: false, error: new RemoteError('gateway/internal', 'late failure', {}) } as never)
    await pending.promise

    const pendingResolve = deferred<never>()
    const resolving = new SubagentModelSelectionCardController(
      host.scope,
      ctxWith({ session: { modelCatalog: () => pendingResolve.promise } }),
    )
    const resolvingFace = resolving.inject()
    resolvingFace.toggleEnabled()
    resolving.dispose()
    pendingResolve.resolve({
      ok: true, value: { groups: [], failures: [] },
    } as never)
    await pendingResolve.promise
  })

  it('ignores writes while read-only and scope notifications after disposal', () => {
    const host = stubConfigForm<SubagentModelSelectionSettings>()
    const controller = new SubagentModelSelectionCardController(host.scope, modelsApi().ctx)
    host.publish({ status: 'ready', writable: false, value: { enabled: false, allowedModels: [] }, user: {} })
    const face = controller.inject()

    face.toggleEnabled()
    face.toggleModel('alpha\0fast')
    face.save()
    expect(host.mutate).not.toHaveBeenCalled()

    controller.dispose()
    controller.refreshCatalog()
    controller.resetConnection()
    face.toggleEnabled()
    face.retryCatalog()
    face.save()
    host.publish({ value: { enabled: true, allowedModels: [{ provider: 'alpha', model: 'fast' }] } })
    expect(host.mutate).not.toHaveBeenCalled()
    expect(face.hooks.subagentModelSelectionCard.getSnapshot().enabled).toBe(false)
  })
})

describe('model selection sibling revision', () => {
  it('keeps a model draft when a sibling field advances the revision', () => {
    const host = stubConfigForm<SubagentModelSelectionSettings>()
    const controller = new SubagentModelSelectionCardController(host.scope, modelsApi().ctx)
    host.publish({
      status: 'ready', writable: true, revision: 4,
      value: { enabled: false, allowedModels: [{ provider: 'alpha', model: 'fast' }] }, user: {},
    })
    const face = controller.inject()
    face.toggleEnabled()
    host.publish({
      revision: 4,
      value: { enabled: false, allowedModels: [{ provider: 'alpha', model: 'fast' }] },
    })
    expect(face.hooks.subagentModelSelectionCard.getSnapshot().dirty).toBe(true)
    host.publish({
      revision: 5,
      value: { enabled: false, allowedModels: [{ provider: 'alpha', model: 'fast' }] },
    })
    expect(face.hooks.subagentModelSelectionCard.getSnapshot()).toMatchObject({
      conflicted: false, dirty: true, enabled: true,
    })
    face.save()
    expect(host.mutate).toHaveBeenCalledWith([
      { op: 'set', path: ['enabled'], value: true },
      { op: 'set', path: ['allowedModels'], value: [{ provider: 'alpha', model: 'fast' }] },
    ], 5)
  })
})

describe('SubagentLimitsCardController', () => {
  it('validates staged limits, saves them, and restores composed defaults', async () => {
    const host = stubConfigForm<SubagentLimitsSettings>()
    const face = new SubagentLimitsCardController(host.scope).inject()
    const state = () => face.hooks.subagentLimitsCard.getSnapshot()
    host.publish({ status: 'ready', writable: true, value: { maxDepth: 3, maxActiveSubagents: 8 }, base: { maxDepth: 3, maxActiveSubagents: 8 }, user: {} })
    acceptWrites(host)
    expect(state().maxActiveSubagents.text).toBe('8')
    for (const draft of ['-1', '1.5', '9007199254740992', 'wat', '-0']) {
      face.edit('maxDepth', draft)
      expect(state().invalid).toBe(true)
    }
    face.edit('maxDepth', '0')
    face.edit('maxActiveSubagents', '0')
    expect(state().invalid).toBe(true)
    face.edit('maxActiveSubagents', '12')
    expect(host.set).not.toHaveBeenCalled()
    face.save()
    await vi.waitFor(() => { expect(state().saving).toBe(false) })
    expect(host.scope.getSnapshot().value).toEqual({ maxDepth: 0, maxActiveSubagents: 12 })
    face.resetField('maxDepth')
    face.edit('maxActiveSubagents', '')
    expect(state().invalid).toBe(false)
    face.save()
    await vi.waitFor(() => { expect(state().saving).toBe(false) })
    expect(host.scope.getSnapshot().value).toEqual({ maxDepth: 3, maxActiveSubagents: 8 })
  })
})

describe('shared Subagent card actions', () => {
  function card() {
    const limits = stubConfigForm<SubagentLimitsSettings>()
    const models = stubConfigForm<SubagentModelSelectionSettings>()
    const limitFace = new SubagentLimitsCardController(limits.scope).inject()
    const modelFace = new SubagentModelSelectionCardController(models.scope, modelsApi().ctx).inject()
    limits.publish({
      status: 'ready', writable: true, revision: 2,
      value: { maxDepth: 3, maxActiveSubagents: 8 },
      base: { maxDepth: 3, maxActiveSubagents: 8 }, user: {},
    })
    models.publish({
      status: 'ready', writable: true, revision: 5,
      value: { enabled: false, allowedModels: [{ provider: 'alpha', model: 'fast' }] }, user: {},
    })
    acceptWrites(limits)
    acceptWrites(models)
    const purposeFace = new SubagentPurposeRoutesCardController(stubConfigForm<PurposeRoutesSettings>().scope, modelsApi().ctx).inject()
    const face = subagentCardFace(limitFace, modelFace, purposeFace)
    const state = () => subagentCardShell(
      face.hooks.subagentLimitsCard.getSnapshot(),
      face.hooks.subagentModelSelectionCard.getSnapshot(),
      face.hooks.subagentPurposeRoutesCard.getSnapshot(),
    )
    return { limits, models, face, state }
  }

  it('saves both drafts through their existing namespaces from one action', async () => {
    const { limits, models, face, state } = card()
    face.editLimit('maxDepth', '2')
    face.toggleEnabled()
    face.save()
    await vi.waitFor(() => { expect(state()).toMatchObject({ saving: false, dirty: false, failed: false }) })
    expect(limits.mutate).toHaveBeenCalledWith([{ op: 'set', path: ['maxDepth'], value: 2 }], 2)
    expect(models.mutate).toHaveBeenCalledWith([
      { op: 'set', path: ['enabled'], value: true },
      { op: 'set', path: ['allowedModels'], value: [{ provider: 'alpha', model: 'fast' }] },
    ], 5)
  })

  it('saves a limit-only draft without rewriting model authorization', async () => {
    const { limits, models, face, state } = card()
    face.editLimit('maxDepth', '2')
    face.save()
    await vi.waitFor(() => { expect(state()).toMatchObject({ saving: false, dirty: false, failed: false }) })
    expect(limits.scope.getSnapshot().value?.maxDepth).toBe(2)
    expect(models.mutate).not.toHaveBeenCalled()
    expect(models.scope.getSnapshot().value?.enabled).toBe(false)
  })

  it('retains the pending draft when discard is requested before both writes finish', async () => {
    const { limits, face, state } = card()
    const pending = deferred<undefined>()
    const set = vi.spyOn(limits.scope, 'mutate').mockImplementationOnce(async () => {
      await pending.promise
      limits.publish({ value: { maxDepth: 2, maxActiveSubagents: 8 }, user: { maxDepth: 2 } })
      return true
    })
    face.editLimit('maxDepth', '2')
    face.toggleEnabled()
    face.save()
    try {
      await vi.waitFor(() => {
        expect(face.hooks.subagentModelSelectionCard.getSnapshot()).toMatchObject({ saving: false, dirty: false })
      })
      expect(state().saving).toBe(true)
      expect(set).toHaveBeenCalledWith([{ op: 'set', path: ['maxDepth'], value: 2 }], 2)
      face.discard()
      expect(face.hooks.subagentLimitsCard.getSnapshot()).toMatchObject({ dirty: true, maxDepth: { text: '2' } })
    } finally {
      pending.resolve(undefined)
      await vi.waitFor(() => { expect(state().saving).toBe(false) })
    }
    expect(state()).toMatchObject({ dirty: false, failed: false })
    expect(limits.scope.getSnapshot().value?.maxDepth).toBe(2)
  })

  it('writes neither namespace when either draft is invalid and discards both', () => {
    const { limits, models, face, state } = card()
    face.editLimit('maxDepth', '1.5')
    face.toggleEnabled()
    face.save()
    expect(limits.set).not.toHaveBeenCalled()
    expect(models.mutate).not.toHaveBeenCalled()
    face.discard()
    expect(state()).toMatchObject({ dirty: false, invalid: false })
    expect(face.hooks.subagentLimitsCard.getSnapshot().maxDepth.text).toBe('3')
    expect(face.hooks.subagentModelSelectionCard.getSnapshot().enabled).toBe(false)
  })

  it('retains a rejected model draft after limits save, and retries only that draft', async () => {
    const { limits, models, face, state } = card()
    models.mutate.mockResolvedValueOnce(false)
    face.editLimit('maxDepth', '2')
    face.toggleEnabled()
    face.save()
    await vi.waitFor(() => { expect(state()).toMatchObject({ saving: false, dirty: true, failed: true }) })
    expect(face.hooks.subagentLimitsCard.getSnapshot().dirty).toBe(false)
    expect(face.hooks.subagentModelSelectionCard.getSnapshot()).toMatchObject({ enabled: true, dirty: true })
    face.save()
    await vi.waitFor(() => { expect(state()).toMatchObject({ saving: false, dirty: false, failed: false }) })
    expect(limits.mutate).toHaveBeenCalledOnce()
    expect(models.mutate).toHaveBeenCalledTimes(2)
  })
})

const fast = {
  id: 'fast',
  name: 'Fast',
  reasoning: {
    efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }],
    defaultEffort: 'low',
  },
}

function route(provider: string, model: string, reasoningEffort: string) {
  return { provider, model, reasoningEffort }
}

function purposeTable(review = [route('alpha', 'fast', 'high')]): PurposeRouteTableDraft {
  return {
    light: [route('alpha', 'fast', 'low')],
    medium: [route('alpha', 'fast', 'high')],
    deep: [route('alpha', 'fast', 'high')],
    review,
    writing: [route('alpha', 'fast', 'low')],
    default: [route('alpha', 'fast', 'high')],
  }
}

function purposeHost(value: PurposeRouteTableDraft | null, revision = 3) {
  const host = stubConfigForm<PurposeRoutesSettings>()
  const catalog = modelsApi({
    groups: [{ id: 'alpha', name: 'Alpha', models: [fast] }],
    failures: [{ id: 'beta', name: 'Beta', message: 'offline' }],
  })
  const controller = new SubagentPurposeRoutesCardController(host.scope, catalog.ctx)
  host.publish({ status: 'ready', writable: true, revision, value: { purposeRoutes: value }, user: {} })
  return { host, catalog, controller, face: controller.inject() }
}

describe('SubagentPurposeRoutesCardController', () => {
  it('reads a missing table as routing off and ignores a non-object', () => {
    expect(purposeRouteTableFromValue(undefined)).toBeNull()
    expect(purposeRouteTableFromValue(null)).toBeNull()
    expect(purposeRouteTableFromValue(['light'])).toBeNull()
    expect(purposeRouteTableFromValue({
      light: 'nope',
      medium: [null, { provider: 1 }, { provider: 'a', model: 1 }, { provider: 'a', model: 'b', reasoningEffort: 1 }, { provider: 'a', model: 'b', reasoningEffort: 'c' }],
    })?.medium).toEqual([{ provider: 'a', model: 'b', reasoningEffort: 'c' }])
    expect(samePurposeRouteTable(null, null)).toBe(true)
    expect(samePurposeRouteTable(null, purposeTable())).toBe(false)
  })

  it('shows the empty state for a null table and does not save one', async () => {
    const { host, face } = purposeHost(null)
    const state = () => face.hooks.subagentPurposeRoutesCard.getSnapshot()
    expect(state()).toMatchObject({ configured: false, rows: [], dirty: false, invalid: false })
    face.addReviewer()
    face.editRoute('light', 0, 'provider', 'alpha')
    face.save()
    await Promise.resolve()
    expect(host.mutate).not.toHaveBeenCalled()
    expect(state().configured).toBe(false)
  })

  it('loads a table, edits one route, and saves the whole table', async () => {
    const { host, face } = purposeHost(purposeTable([{ provider: 'legacy', model: 'old', reasoningEffort: 'high' }]), 8)
    acceptWrites(host)
    const state = () => face.hooks.subagentPurposeRoutesCard.getSnapshot()
    await vi.waitFor(() => { expect(state().catalogStatus).toBe('ready') })
    expect(state().catalogPartial).toBe(true)
    const review = state().rows.find(row => row.slot === 'review')
    expect(review?.routes[0]).toMatchObject({ available: false, provider: 'legacy', model: 'old' })
    face.editRoute('light', 0, 'provider', 'alpha')
    expect(state().rows.find(row => row.slot === 'light')?.routes[0]).toMatchObject({
      provider: 'alpha', model: 'fast', reasoningEffort: 'low',
    })
    face.editRoute('deep', 0, 'effort', 'low')
    face.save()
    await vi.waitFor(() => { expect(state().dirty).toBe(false) })
    expect(host.mutate).toHaveBeenCalledWith([{
      op: 'set',
      path: ['purposeRoutes'],
      value: {
        ...purposeTable([{ provider: 'legacy', model: 'old', reasoningEffort: 'high' }]),
        light: [route('alpha', 'fast', 'low')],
        deep: [route('alpha', 'fast', 'low')],
      },
    }], 8)
  })

  it('adds, reorders, and removes reviewers without dropping the last route', async () => {
    const { host, face } = purposeHost(purposeTable())
    acceptWrites(host)
    const state = () => face.hooks.subagentPurposeRoutesCard.getSnapshot()
    await vi.waitFor(() => { expect(state().catalogStatus).toBe('ready') })
    const efforts = () => state().rows.find(row => row.slot === 'review')?.routes.map(item => item.reasoningEffort)
    face.addReviewer()
    face.editRoute('review', 1, 'provider', 'alpha')
    face.moveReviewer(1, 'later')
    face.moveReviewer(1, 'earlier')
    face.removeReviewer(5)
    expect(efforts()).toEqual(['low', 'high'])
    face.save()
    await vi.waitFor(() => { expect(state().dirty).toBe(false) })
    expect(host.mutate.mock.calls[0]?.[0]).toEqual([{
      op: 'set',
      path: ['purposeRoutes'],
      value: {
        ...purposeTable(),
        review: [route('alpha', 'fast', 'low'), route('alpha', 'fast', 'high')],
      },
    }])
    face.removeReviewer(0)
    expect(efforts()).toEqual(['high'])
    face.removeReviewer(0)
    expect(efforts()).toEqual(['high'])
  })

  it('refuses a duplicate, an unsupported effort, a missing field, and an empty slot', async () => {
    const { host, face } = purposeHost(purposeTable())
    const state = () => face.hooks.subagentPurposeRoutesCard.getSnapshot()
    await vi.waitFor(() => { expect(state().catalogStatus).toBe('ready') })
    face.addReviewer()
    face.editRoute('review', 1, 'provider', 'alpha')
    face.editRoute('review', 1, 'effort', 'high')
    expect(state()).toMatchObject({ invalid: true, dirty: true })
    expect(state().rows.find(row => row.slot === 'review')?.duplicate).toBe(true)
    face.save()
    await Promise.resolve()
    expect(host.mutate).not.toHaveBeenCalled()

    face.editRoute('review', 1, 'effort', 'max')
    expect(state().rows.find(row => row.slot === 'review')?.routes[1]?.effortUnsupported).toBe(true)
    face.editRoute('review', 1, 'model', '')
    expect(state().rows.find(row => row.slot === 'review')?.routes[1]?.missing).toBe(true)
    face.removeReviewer(1)

    face.editRoute('writing', 0, 'provider', '')
    expect(state().rows.find(row => row.slot === 'writing')?.routes[0]?.missing).toBe(true)
    face.discard()
    expect(state().dirty).toBe(false)
  })

  it('blocks a save while the catalogue is loading and still saves an unavailable saved route', async () => {
    const pending = deferred<never>()
    const host = stubConfigForm<PurposeRoutesSettings>()
    const models = vi.fn()
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValueOnce({
        ok: true,
        value: { groups: [], failures: [] },
      })
    const controller = new SubagentPurposeRoutesCardController(host.scope, ctxWith({ session: { modelCatalog: models } }))
    host.publish({
      status: 'ready', writable: true, revision: 2,
      value: { purposeRoutes: purposeTable([{ provider: 'legacy', model: 'old', reasoningEffort: 'high' }]) },
      user: {},
    })
    const face = controller.inject()
    const state = () => face.hooks.subagentPurposeRoutesCard.getSnapshot()
    await vi.waitFor(() => { expect(state().catalogStatus).toBe('loading') })
    face.editRoute('default', 0, 'effort', 'low')
    expect(state().invalid).toBe(true)
    face.save()
    expect(host.mutate).not.toHaveBeenCalled()
    pending.resolve({ ok: true, value: { groups: [], failures: [] } } as never)
    await vi.waitFor(() => { expect(state().catalogStatus).toBe('ready') })
    expect(state().rows.find(row => row.slot === 'review')?.routes[0]?.available).toBe(false)
    acceptWrites(host)
    face.save()
    await vi.waitFor(() => { expect(state().dirty).toBe(false) })
    expect(host.mutate).toHaveBeenCalledOnce()
  })

  it('reports a revision conflict and advances the fence for a sibling write', async () => {
    const { host, face } = purposeHost(purposeTable(), 4)
    const state = () => face.hooks.subagentPurposeRoutesCard.getSnapshot()
    await vi.waitFor(() => { expect(state().catalogStatus).toBe('ready') })
    const replaced = purposeTable([route('other', 'new', 'low')])
    face.editRoute('light', 0, 'effort', 'high')
    host.publish({ revision: 5, value: { purposeRoutes: replaced } })
    expect(state()).toMatchObject({ conflicted: true, dirty: true })
    face.save()
    await Promise.resolve()
    expect(host.mutate).not.toHaveBeenCalled()
    face.discard()
    expect(state()).toMatchObject({ conflicted: false, dirty: false })

    face.editRoute('light', 0, 'effort', 'high')
    host.publish({ revision: 6, value: { purposeRoutes: replaced } })
    expect(state()).toMatchObject({ conflicted: false, dirty: true })
    acceptWrites(host)
    face.save()
    await vi.waitFor(() => { expect(host.mutate).toHaveBeenCalled() })
    expect(host.mutate.mock.calls[0]?.[1]).toBe(6)
  })

  it('keeps a rejected draft and ignores edits while read-only or disposed', async () => {
    const { host, face, controller } = purposeHost(purposeTable())
    const state = () => face.hooks.subagentPurposeRoutesCard.getSnapshot()
    await vi.waitFor(() => { expect(state().catalogStatus).toBe('ready') })
    face.editRoute('medium', 0, 'model', 'fast')
    face.save()
    await vi.waitFor(() => { expect(state().failed).toBe(true) })
    expect(state()).toMatchObject({ dirty: true, saving: false })

    host.publish({ writable: false })
    face.addReviewer()
    face.removeReviewer(0)
    face.moveReviewer(0, 'earlier')
    expect(state().rows.find(row => row.slot === 'review')?.routes).toHaveLength(1)
    controller.dispose()
    face.editRoute('medium', 0, 'effort', 'low')
    face.retryCatalog()
    controller.refreshCatalog()
    controller.resetConnection()
    expect(host.mutate).toHaveBeenCalledOnce()
  })

  it('fills an empty slot and collapses an extra non-review route on edit', async () => {
    const stored = purposeTable()
    stored.writing = []
    stored.review = []
    stored.light = [route('alpha', 'fast', 'low'), route('alpha', 'fast', 'high')]
    const { host, face } = purposeHost(stored)
    acceptWrites(host)
    const state = () => face.hooks.subagentPurposeRoutesCard.getSnapshot()
    await vi.waitFor(() => { expect(state().catalogStatus).toBe('ready') })
    expect(state().rows.find(row => row.slot === 'writing')?.empty).toBe(true)
    expect(state().rows.find(row => row.slot === 'review')?.empty).toBe(true)
    expect(state().rows.find(row => row.slot === 'light')?.extra).toBe(true)
    expect(state().invalid).toBe(true)
    face.editRoute('writing', 0, 'provider', 'alpha')
    face.addReviewer()
    face.editRoute('review', 0, 'provider', 'alpha')
    face.editRoute('light', 1, 'effort', 'low')
    expect(state().rows.find(row => row.slot === 'writing')?.empty).toBe(false)
    expect(state().rows.find(row => row.slot === 'light')?.routes).toHaveLength(1)
    expect(state().invalid).toBe(false)
    face.save()
    await vi.waitFor(() => { expect(state().dirty).toBe(false) })
    expect(host.mutate.mock.calls[0]?.[0]).toEqual([{
      op: 'set',
      path: ['purposeRoutes'],
      value: {
        ...purposeTable(),
        light: [route('alpha', 'fast', 'low')],
        review: [route('alpha', 'fast', 'low')],
        writing: [route('alpha', 'fast', 'low')],
      },
    }])
  })

  it('clears a draft the Host already landed, and ignores a same-revision notice', async () => {
    const { host, face } = purposeHost(purposeTable(), 4)
    const state = () => face.hooks.subagentPurposeRoutesCard.getSnapshot()
    await vi.waitFor(() => { expect(state().catalogStatus).toBe('ready') })
    face.editRoute('light', 0, 'effort', 'high')
    host.publish({ revision: 4, value: { purposeRoutes: purposeTable() } })
    expect(state().dirty).toBe(true)
    const landed = { ...purposeTable(), light: [route('alpha', 'fast', 'high')] }
    host.publish({ revision: 5, value: { purposeRoutes: landed } })
    expect(state()).toMatchObject({ dirty: false, conflicted: false })
  })

  it('uses the first advertised effort when the model has no usable default', async () => {
    const host = stubConfigForm<PurposeRoutesSettings>()
    const catalog = modelsApi({
      groups: [{
        id: 'alpha',
        name: 'Alpha',
        models: [
          { id: 'plain', name: 'Plain', reasoning: { efforts: [{ id: 'high', name: 'High' }] } },
          { id: 'odd', name: 'Odd', reasoning: { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'missing' } },
          { id: 'bare', name: 'Bare' },
        ],
      }],
    })
    const controller = new SubagentPurposeRoutesCardController(host.scope, catalog.ctx)
    host.publish({ status: 'ready', writable: true, revision: 1, value: { purposeRoutes: purposeTable() }, user: {} })
    const face = controller.inject()
    const state = () => face.hooks.subagentPurposeRoutesCard.getSnapshot()
    await vi.waitFor(() => { expect(state().catalogStatus).toBe('ready') })
    face.editRoute('light', 0, 'model', 'plain')
    expect(state().rows.find(row => row.slot === 'light')?.routes[0]?.reasoningEffort).toBe('high')
    face.editRoute('light', 0, 'model', 'odd')
    expect(state().rows.find(row => row.slot === 'light')?.routes[0]?.reasoningEffort).toBe('high')
    face.editRoute('light', 0, 'model', 'bare')
    expect(state().rows.find(row => row.slot === 'light')?.routes[0]?.missing).toBe(true)
    face.editRoute('light', 0, 'provider', 'alpha')
    face.editRoute('light', 0, 'provider', 'alpha')
    face.editRoute('medium', 0, 'provider', 'missing')
    face.editRoute('review', 4, 'effort', 'low')
    face.removeReviewer(-1)
    face.moveReviewer(9, 'later')
    expect(state().rows.find(row => row.slot === 'review')?.routes).toHaveLength(1)
    face.save()
    expect(host.mutate).not.toHaveBeenCalled()
    host.publish({ writable: false })
    face.save()
    expect(host.mutate).not.toHaveBeenCalled()
  })

  it('reports a catalogue error, drops a late load, and ignores a save after disposal', async () => {
    const pending = deferred<never>()
    const host = stubConfigForm<PurposeRoutesSettings>()
    const models = vi.fn()
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValue({ ok: false, error: new RemoteError('gateway/internal', 'offline', {}) })
    const controller = new SubagentPurposeRoutesCardController(host.scope, ctxWith({ session: { modelCatalog: models } }))
    host.publish({
      status: 'ready', writable: true, revision: 2,
      value: { purposeRoutes: purposeTable() },
      user: {},
    })
    const face = controller.inject()
    const state = () => face.hooks.subagentPurposeRoutesCard.getSnapshot()
    await vi.waitFor(() => { expect(state().catalogStatus).toBe('loading') })
    face.retryCatalog()
    expect(models).toHaveBeenCalledOnce()
    controller.refreshCatalog()
    pending.resolve({ ok: true, value: { groups: [], failures: [] } } as never)
    await pending.promise
    await vi.waitFor(() => { expect(state().catalogStatus).toBe('error') })
    const write = deferred<boolean>()
    host.mutate.mockImplementationOnce(() => write.promise)
    face.editRoute('default', 0, 'effort', 'low')
    const saving = face.save()
    face.discard()
    expect(state().dirty).toBe(true)
    controller.dispose()
    write.resolve(true)
    await saving
    expect(state().saving).toBe(true)
  })

  it('writes the purpose table after a sibling model write and uses the new revision', async () => {
    const host = stubConfigForm<SubagentModelSelectionSettings & PurposeRoutesSettings>()
    const catalog = modelsApi({ groups: [{ id: 'alpha', name: 'Alpha', models: [fast] }] })
    let revision = 4
    host.mutate.mockImplementation(async () => {
      const current = host.scope.getSnapshot().value
      revision += 1
      host.publish({
        revision,
        value: {
          enabled: current?.enabled ?? false,
          allowedModels: current?.allowedModels ?? [],
          purposeRoutes: current?.purposeRoutes ?? null,
        },
      })
      return true
    })
    host.publish({
      status: 'ready', writable: true, revision,
      value: { enabled: false, allowedModels: [{ provider: 'alpha', model: 'fast' }], purposeRoutes: purposeTable() },
      user: {},
    })
    const limits = new SubagentLimitsCardController(stubConfigForm<SubagentLimitsSettings>().scope).inject()
    const models = new SubagentModelSelectionCardController(host.scope, catalog.ctx).inject()
    const purpose = new SubagentPurposeRoutesCardController(host.scope, catalog.ctx).inject()
    const face = subagentCardFace(limits, models, purpose)
    await vi.waitFor(() => { expect(purpose.hooks.subagentPurposeRoutesCard.getSnapshot().catalogStatus).toBe('ready') })
    face.toggleEnabled()
    purpose.editRoute('default', 0, 'effort', 'low')
    face.save()
    await vi.waitFor(() => { expect(host.mutate).toHaveBeenCalledTimes(2) })
    expect(host.mutate.mock.calls[0]?.[1]).toBe(4)
    expect(host.mutate.mock.calls[1]?.[1]).toBe(5)
    expect(host.mutate.mock.calls[1]?.[0]).toEqual([{
      op: 'set',
      path: ['purposeRoutes'],
      value: { ...purposeTable(), default: [route('alpha', 'fast', 'low')] },
    }])
  })

  it('saves a purpose-only draft without rewriting model authorization', async () => {
    const host = stubConfigForm<SubagentModelSelectionSettings & PurposeRoutesSettings>()
    acceptWrites(host)
    const catalog = modelsApi({ groups: [{ id: 'alpha', name: 'Alpha', models: [fast] }] })
    host.publish({
      status: 'ready', writable: true, revision: 3,
      value: { enabled: false, allowedModels: [], purposeRoutes: purposeTable() },
      user: {},
    })
    const limits = new SubagentLimitsCardController(stubConfigForm<SubagentLimitsSettings>().scope).inject()
    const models = new SubagentModelSelectionCardController(host.scope, catalog.ctx).inject()
    const purpose = new SubagentPurposeRoutesCardController(host.scope, catalog.ctx).inject()
    const face = subagentCardFace(limits, models, purpose)
    await vi.waitFor(() => { expect(purpose.hooks.subagentPurposeRoutesCard.getSnapshot().catalogStatus).toBe('ready') })
    purpose.editRoute('default', 0, 'effort', 'low')
    face.save()
    await vi.waitFor(() => { expect(host.mutate).toHaveBeenCalledOnce() })
    expect(host.mutate.mock.calls[0]?.[0]).toEqual([{
      op: 'set',
      path: ['purposeRoutes'],
      value: { ...purposeTable(), default: [route('alpha', 'fast', 'low')] },
    }])
    expect(models.hooks.subagentModelSelectionCard.getSnapshot().dirty).toBe(false)
  })
})
