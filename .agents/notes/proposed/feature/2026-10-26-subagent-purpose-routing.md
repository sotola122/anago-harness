# Agent Note: Subagent purpose routing

Status: proposed

English | [中文](2026-10-26-subagent-purpose-routing.zh.md)

## Problem

The parent model chooses a child model by naming `provider`, `model`, and `reasoning_effort`, or by omitting them and inheriting the parent route or the tool instance's static `agentOptions`. A deployment that wants a different child model for a lookup, an implementation, a design, a review, or prose has no purpose label to pass. Putting provider and model names in the prompt publishes deployment-specific routes. One tool instance per purpose freezes each route in static `agentOptions`, so a settings edit cannot apply on the next delegation without a new Session.

Review has the same gap in the other direction. One `subagent` call starts one child. A deployment that wants several reviewers must issue several calls and name each route.

[User-authorized subagent model routes](../../implemented/feature/2026-08-24-user-authorized-subagent-model-routes.md) correctly freezes `allowedModels` at Session composition, because a settings edit must not silently change a running Session's model-visible authority. That rule does not give the deployment a purpose table it can edit for the next delegation. Failure handling is also open: when a child fails to start, ends in error, or returns an unusable result, the parent decides whether to try again, and the runtime cannot tell that a later call is the same task.

anago-core still inserts Cursor and Pi subagent rows in [its patch](../../../../packages/fork/anago-core/cordis.patch.yml) (`subagent-cursor`, `tool-subagent-cursor`, `subagent-pi`, `tool-subagent-pi`). Those rows are a separate product path with `providerOwnedRoute`, not a purpose label. Leaving them in place while adding purpose routing mixes two tool-catalog changes.

## Proposal

When a `subagent` instance sets `purposeRouting: true`, the parent passes a closed purpose label, `category`, and the runtime resolves the child route from a Host purpose table read on that call. The parent does not see provider names, model names, or the table. `list_subagent_models` does not list the table either. There is no fallback parameter, no per-purpose fallback route, and no runtime route switch. If the child fails to start, ends in error, or returns an unusable result, the parent re-delegates once with the same `category` — omitting `category` again when the failed call omitted it — and reports to the user if that second call also fails.

`category: "review"` starts one child per route configured on that row and returns `subagentIds` and `notStarted`. Other categories start exactly one child.

The table is edited on the existing subagent settings card and applies on the next delegation. `allowedModels` stays a Session snapshot. This proposal does not reopen that decision: an explicit `provider` / `model` / `reasoning_effort` selection remains subject to the allowlist. The route arguments, adapter preflight, and discovery tool stay owned by [model-selected subagent routes](../../../../packages/subagent/tool-subagent/README.md).

### Non-goals

- Switching to another route inside the same call.
- Disclosing the purpose table to the model.
- A per-category persona or tool set. `agent_preset` stays independent of `category`.
- Applying `category` to `subagent_fork`, `workflow-ptc`, or an external CLI provider.
- User-defined categories. The set is closed.
- A TUI editor, cost metering, or a budget control.

### Categories and the purpose table

New module `packages/subagent/tool-subagent/src/purpose-routing.ts`:

```text
/** Model-facing purpose labels. Closed set; array order is the settings UI order. */
export const PURPOSE_CATEGORIES = ['light', 'medium', 'deep', 'review', 'writing'] as const
export type PurposeCategory = typeof PURPOSE_CATEGORIES[number]

/** Table rows: every model-facing label plus the row used when `category` is omitted. */
export const PURPOSE_ROUTE_SLOTS = [...PURPOSE_CATEGORIES, 'default'] as const
export type PurposeRouteSlot = typeof PURPOSE_ROUTE_SLOTS[number]

/** Slots whose list may hold several routes started in parallel. */
const FAN_OUT_SLOTS: ReadonlySet<PurposeRouteSlot> = new Set(['review'])

/** One fully specified child route. */
export interface PurposeRoute {
  readonly provider: string
  readonly model: string
  /** Required: an omitted effort would leave inheritance across different models ambiguous. */
  readonly reasoningEffort: ReasoningEffortId
}

/**
 * Complete table: every slot is required.
 * A non-fan-out slot holds exactly one route. `review` holds one or more.
 */
export type PurposeRouteTable = { readonly [S in PurposeRouteSlot]: readonly PurposeRoute[] }
```

`default` is not a model-facing enum value. Omitting `category` selects that row. Accepting both omission and `"default"` would make two spellings of one choice.

The table is a closed object of six required slots. A missing slot fails Schemastery validation, so it cannot occur at runtime. `assertPurposeRouteTable` rejects an empty list, more than one route on a slot outside `FAN_OUT_SLOTS`, and a duplicate provider/model/effort triple in one slot. `reasoningEffort` is required on every route so a changed model does not silently inherit the parent's effort or fall through to a model default.

A row is the route list itself. The table has no wrapper object and no fallback field.

### Host settings and load checks

Add one volatile field to `SubagentModelSelectionConfig` in `packages/subagent/tool-subagent/src/model-selection-settings.ts`:

```text
export interface Config {
  enabled: Volatile<boolean>
  allowedModels: Volatile<AllowedModelRoute[]>
  /** Purpose routing table read at every delegation; null when this deployment has none. */
  purposeRoutes: Volatile<PurposeRouteTable | null>
}

/**
 * Read a detached copy of the current purpose routing table.
 * @returns the validated table, or null when none is configured.
 */
purposeRoutes(): PurposeRouteTable | null
```

`current()` still samples `enabled` and `allowedModels` once when the Session is composed. `purposeRoutes()` reads the live value on each delegation. Both live on the profile entry `subagent-model-selection-settings` because the Web form is already bound to that id; a second card is unnecessary. The generic plugin default is `null`. Concrete routes differ by deployment, so plugin code does not hardcode them.

`packages/subagent/tool-subagent/src/index.ts` gains `purposeRouting?: boolean`, schema `z.boolean().default(false)`. Load fails immediately when any of these hold:

- `purposeRouting: true` and the Host scope has no `subagentModelSelection` service.
- `purposeRouting: true` and `settings.purposeRoutes()` is `null`.
- `purposeRouting: true` together with `agentOptions.provider`, `agentOptions.model`, or `agentOptions.reasoningEffort`. `maxTokens` may combine.
- `purposeRouting: true` together with `providerOwnedRoute: true`, only if that field still exists after the Cursor and Pi retirement below.

Resolution carries no attempt kind:

```text
export type ChildRouteSource =
  | { readonly kind: 'configured' } // purposeRouting off; config.agentOptions or parent inheritance
  | { readonly kind: 'explicit' }   // provider / model / reasoning_effort
  | { readonly kind: 'purpose'; readonly slot: PurposeRouteSlot }

export interface ChildRouteResolution {
  readonly source: ChildRouteSource
  /** One entry per child to start. More than one only for `review`. */
  readonly children: readonly (AgentOptions | undefined)[]
}
```

Existing paths are the same result with `children.length === 1`, so execute starts children in one loop.

The shipping table is an id override of `subagent-model-selection-settings` in [anago-web's patch](../../../../packages/fork/anago-web/cordis.patch.yml). These primary routes are the proposed deployment values. Plugin code does not own them.

```yaml
- id: subagent-model-selection-settings
  name: '@deepseek-ai/dsh-tool-subagent/model-selection-settings'
  config:
    purposeRoutes:
      light:
        - { provider: xai, model: grok-4.7, reasoningEffort: medium }
      medium:
        - { provider: xai, model: grok-4.7, reasoningEffort: high }
      deep:
        - { provider: xai, model: grok-4.7, reasoningEffort: xhigh }
      review:
        - { provider: xai, model: grok-4.7, reasoningEffort: xhigh }
      writing:
        - { provider: github-copilot, model: gemini-3.8-flash, reasoningEffort: medium }
      default:
        - { provider: opencode-go, model: deepseek-v4.1-flash, reasoningEffort: high }
```

`purposeRouting: true` is one field on the live `tool-subagent` row that serves `subagent`. That row is the `preset-standard` entry in [standard.patch.yml](../../../../packages/bundle/web-app/presets/standard.patch.yml). The anago-web top-level `tool-subagent` row is a separate registration question recorded under Risks; do not enable the flag on two rows that both register `subagent`.

Compatibility:

- A profile with neither `purposeRoutes` nor `purposeRouting` keeps today's behavior. The field defaults to `null`.
- Past calls have no `category`. After resume, new calls use the updated tool schema, as any other tool-catalog update does.
- The new event below is `ignorable: true`. Do not bump `SESSION_FORMAT_VERSION`.
- On anago-web, a delegation that omits `category` uses the `default` row instead of inheriting the parent route. Record that in an upgrade guide.

### Tool schema

Only a `purposeRouting: true` instance adds an argument. A `purposeRouting: false` instance keeps its description and existing argument text byte-identical. Category text is appended only on the enabled instance.

| Argument | Type | Required |
|---|---|---|
| `category` | string enum `light`, `medium`, `deep`, `review`, `writing` | no |

There is no `fallback` argument.

Model-facing text is English and pinned verbatim by a snapshot. Append this sentence to the tool description:

```text
Choose `category` to match the task; the runtime picks a suitable child model for it. Omit `category` for general work. If a subagent fails to start, ends with an error, or returns an unusable result, re-delegate the same task once with the same `category`. If the failed call omitted `category`, omit it again. If that also fails, stop retrying and report the failure.
```

`category`:

```text
Task purpose that selects the child model. `light`: quick lookups, small mechanical edits, short summaries. `medium`: ordinary implementation or investigation. `deep`: hard debugging, design, or long multi-step reasoning. `review`: independent review of a change, plan, or document; may start several reviewers in parallel, each reporting separately. `writing`: documentation, PR or issue text, translation, user-facing prose. Do not combine with `provider`, `model`, or `reasoning_effort`.
```

When the Session has model-selection policy enabled, append `Do not combine with \`category\`.` to the existing `provider`, `model`, and `reasoning_effort` descriptions, and only when `purposeRouting` is true. No model-facing string names a provider, a model, a routing table, or settings.

Exclusivity:

- `category` cannot combine with `provider`, `model`, or `reasoning_effort`. Effort is chosen by the row, so it is part of the exclusion.
- `agent_preset` and `cwd` combine with `category`.
- Omitting `category` is valid. It selects the `default` row.

Output fields:

```text
properties: {
  kind: { const: 'activation', required: true },
  subagentId: { type: 'string', required: true }, // first started child; existing readers keep this field
  subagentIds: { type: 'array', items: { type: 'string' } }, // review only; includes subagentId first
  notStarted: { type: 'integer' }, // review only; reviewers that did not start
}
```

Render:

- One started child and `notStarted` absent or zero: `started subagent <id>` (unchanged).
- Review that starts more than one child, or review with `notStarted > 0`: `started 3 subagents: <id1>, <id2>, <id3>`, then `; 1 reviewer could not start` when `notStarted > 0`.

`subagentId` stays because persisted tool results and the existing Web card read that field alone. A review row always includes `subagentIds` and `notStarted`, including a row with one route and `notStarted: 0`.

Errors are thrown inside `execute` and returned as the tool error. Arguments are frozen before execute and remain in the log.

| Condition | Where judged | Model-facing result |
|---|---|---|
| `category` combined with a route argument | start of resolution | `` `category` cannot be combined with `provider`, `model`, or `reasoning_effort` `` |
| `category` outside the enum | executor JSON validation and the resolver | `` unknown category "x"; use light, medium, deep, review, or writing, or omit it `` |
| `category` while `purposeRouting` is false | resolver | `category selection is not available for this tool` |
| table `null`, or the settings service missing, at the call | resolver | `no child model is configured for this tool; report that to the user` |
| every selected route fails preflight or start | after preflight or the start loop | `` the model for category `deep` is unavailable; re-delegate once with the same `category` `` |

When the failed call omitted `category`, the last row says to re-delegate once without `category`, and it does not mention `default`. Preflight and start failures carry a cause that includes the provider and model. That cause is not returned to the model. It is kept on the event below and in the Host logger.

### Resolution

Split a pure `resolvePurposeRoutes(table, slot)` from the execute procedure. `resolvePurposeRoutes` returns `table[slot]` and does not take an attempt.

```text
execute(args):
  parent = exec.agent; session = parent.session
  modelReq = {provider, model, reasoning_effort}
  purposeReq = {category}

  1. Exclusivity. purposeRouting false with category is an error.
  2. purposeRouting true: read the table once via runtimeCtx.get('subagentModelSelection')?.purposeRoutes().
     Missing service or null table is an error, including for an explicit route call.
  3. Any modelReq field set → explicit path
       configured = purposeRouting
         ? { ...config.agentOptions, ...routeOf(table.default[0]) }
         : config.agentOptions
       options = requestedAgentOptions(parentOptions, configured, modelReq, modelSelectionEnabled)
       assertAllowedModelSelection(policy, ...)
       preflight (existing)
       children = [options]
  4. Otherwise, purposeRouting true → purpose path
       slot = purposeReq.category ?? 'default'
       routes = table[slot]
       for each route, in table order:
         opts = { ...providerRouteDefaults, ...config.agentOptions, provider, model, reasoningEffort }
         preflightChildLlmRoute(llm, parentOptions, opts, signal, inheritParentReasoningEffort: false)
         drop a failed route and record not-started
       zero routes left → error
       after every preflight, run the existing provider-swap check once
       do not check allowedModels
  5. Otherwise → existing configured path
  6. startActivation each remaining child in order
```

Priority: explicit route arguments > `category` (omission selects `default`) > `config.agentOptions` (route fields cannot coexist with `purposeRouting` at load, except `maxTokens`) > provider route defaults > parent inheritance.

With `purposeRouting: true`, a call that sets only `reasoning_effort` uses the `default` row's provider and model and replaces the effort. That row is the configured-child-default layer.

The table is read once per execute, before fan-out, so an edit during the call does not change it. The service is not captured at apply. `runtimeCtx.get('subagentModelSelection')` on each call avoids a stale instance after the settings plugin is replaced.

An unknown category is an error. It is not rewritten to `default`. A missing row cannot occur under the schema. A null table or a missing service is a call-time error. The load checks usually stop first; a hand-edited profile or a replacement after load can still reach the call.

`allowedModels` restricts only an explicit route selection. A category call is authorized by the user-authored table; the model chose a label. That matches the existing rule that configured defaults skip the policy check. Preflight still runs. The exception is effort-only explicit selection: the base route is the `default` row, and that route is rejected when it is outside `allowedModels`. State that in the package README.

### Settings card and delegation card

Add `SubagentPurposeRoutesFields.tsx`, its CSS module, and `subagent-purpose-routes-card-controller.ts` under `packages/client/ui-settings-subagent`, and mount one section on `SubagentCard.tsx` after Limits and Model selection.

The section is six rows in `PURPOSE_ROUTE_SLOTS` order.

| Column | Contents |
|---|---|
| Purpose | Localized label (light, standard, deep, review, writing, default) and a one-line hint |
| Routes | Provider/model picker and effort select. Only `review` shows add and remove. The row cannot drop below one route |

There is no fallback column and no "use a fallback" toggle. Provider and model choices reuse the picker and catalog path of `SubagentModelSelectionFields`. Effort choices are the efforts the selected model advertises. The section says that a table edit applies on the next delegation, and that `allowedModels` still applies only to a newly composed Session.

Narrow widths stack each row. Client save is blocked for a missing required field, a duplicate triple on `review`, or an effort the selected model does not advertise. An unregistered or unauthenticated provider warns and still saves, so a later OAuth login is not blocked. Schemastery and `assertPurposeRouteTable` are the final decision. A rejected save uses the existing card error placement. The save payload is the whole `purposeRoutes` value, through the same profile-entry path as `allowedModels`. There is no per-row write.

Copy lives in the typed `locales.ts` dictionary and goes through `t`. Keys:

```text
purposeRoutes.title
purposeRoutes.description
purposeRoutes.appliesNextDelegation
purposeRoutes.slot.{light,medium,deep,review,writing,default}.label
purposeRoutes.slot.{light,medium,deep,review,writing,default}.hint
purposeRoutes.primary
purposeRoutes.addReviewer
purposeRoutes.removeReviewer
purposeRoutes.errors.duplicateRoute
purposeRoutes.errors.effortUnsupported
purposeRoutes.warnings.providerUnavailable
purposeRoutes.notConfigured
```

When the Host returns `purposeRoutes: null`, show the empty state and no initialize button. The shipping table belongs to anago-web. When the settings service itself is absent, omit the section, as the existing card does.

The delegation card is built from the raw `subagent/purpose-route` event and the persisted `subagentIds`. It shows the purpose label, the provider/model/effort actually used, and a link to each started child. A route that did not start shows the event `reason` to the user. That is the cause withheld from the model. The card does not show a primary/fallback distinction, because the table has no fallback route.

### Session log

`category` is frozen before execute by the existing argument log. Append one log-only parent event, with no `surfaceOp` and `ignorable: true`:

```text
'subagent/purpose-route': {
  /** Tool call that resolved this route. */
  toolCallId: ToolCallId
  slot: PurposeRouteSlot
  route: { provider: string; model: string; reasoningEffort: string }
  outcome:
    | { kind: 'started'; childId: SubagentChildId }
    | { kind: 'not-started'; reason: string }
}
```

Append when that child's outcome is committed: `started` after `startActivation` succeeds, `not-started` after the failure is settled. `outcome` is a closed union; readers end it with `assertNever`. The event has no attempt field.

Model-visible parent inputs are the tool schema, the arguments, the tool result, and the completion notice. The schema comes from static Config. Arguments, results, and notices are already logged. The route is not visible to the parent model, so this event is not required for that logging rule. It exists so audit and the delegation card can recover the route after the table is edited. The child Session's own log reproduces the child model request. If that log does not already record the effective route, the same change adds that record.

Adding the member to `SessionEventMap` follows [the persistence type-change review](../../../../docs/cookbook/reviewing-persistence-type-changes.md). Update the TypeScript and Python SDK expected outputs in the same change. Leave `subagent/model-selection-policy` unchanged. Whether `provider` and `model` arguments are visible remains that event's decision.

### Same-category retry

The tool description states the retry rule. The runtime cannot tell whether a later call is the same task, so it does not enforce the count.

| What happened | Failure? | Parent action |
|---|---|---|
| Tool error (preflight or start failure) | yes | Re-delegate once with the same `category`, or omit it again if the failed call omitted it |
| Completion notice in error (provider error, expired auth, rate limit) | yes | Same |
| Completed, but empty or unusable | the parent may treat it as a failure | Same |
| User interrupt or stop, including abort during the start loop | no | Do not re-delegate |
| The second call also fails | — | Stop retrying and report. Do not change `category` to avoid the failure |

The limit is one re-delegation per task, two calls in total. It is not a numeric setting. Nothing in the table supplies a second route, so a retry uses the routes configured for that same slot at the later call.

### Review fan-out

One `category: "review"` call starts one child per `review` route, with the same `prompt`. Completion notices arrive per child. The parent waits for every reviewer's completion notice, then synthesizes, and states where they disagree.

A review call that starts at least one child is a successful tool result. `subagentIds` lists the started children, with `subagentId` first, and `notStarted` counts the rest. The call does not start a second wave. If a started reviewer later ends in error, or the parent judges the set unusable, the parent may re-delegate once with `category: "review"`. That later call fans out again over the routes configured at that later call. It does not stop the children already started. If the later call also fails, keep the reviewer results already in hand and report the reduced coverage.

Runtime start rules:

1. Preflight every selected route sequentially in table order, so event order is deterministic.
2. `startActivation` in that same order for routes that passed.
3. Partial failure: do not stop children already started. Report `subagentIds` and `notStarted`. If none start, return the tool error.
4. Abort during the start loop (`exec.signal`): stop children already started through the subagents service, then return the abort error, so no started child lacks an id the parent can see. Confirm the stop operation's name at implementation.
5. The concurrency cap stays with existing subagent limits. A limit refusal is a partial failure.

### Cursor and Pi retirement

Ship the retirement before the routing change, so the routing snapshot diff is only the category change.

1. Delete `subagent-cursor`, `tool-subagent-cursor`, `subagent-pi`, and `tool-subagent-pi` from [anago-core's patch](../../../../packages/fork/anago-core/cordis.patch.yml), and drop the matching dependencies from anago-core `package.json`.
2. Once `@anago-harness/subagent-cursor` and `@anago-harness/subagent-pi` have no product user, `scripts/product-package-policy.ts` rejects them. Delete the packages in that same change if nothing else uses them. Do not add a classification to keep them.
3. Delete `providerOwnedRoute` and `providerOwnedAgentOptions` if cursor and pi are their only users. Check fixtures, including `packages/subagent/subagent-dsh-sdk/tests/fixtures/loader/dsh-sdk.patch.yml`. After deletion, the routing execute has no `providerOwnedRoute` branch. If the field remains, keep the load-time exclusion above.
4. Update TUI docs and comments that name `subagent_cursor` or `subagent_pi` to the current description. Keep the cross-process Session lease that lets an idle Agent return write ownership so another process can open the same Session.
5. Record the tool deletion in an upgrade guide.
6. Regenerate snapshots whose catalog includes anago-core.

The cursor and pi rows are a different tool instance. They do not interact with purpose routing. Retiring them first keeps that deletion out of the routing review.

### Delivery

| Change | Home |
|---|---|
| Cursor and Pi retirement | anago-core patch and package dependencies; delete unused packages |
| Types, schema, resolver, conditional arguments, event, start loop, tests, README | `packages/subagent/tool-subagent` |
| Settings section and delegation card | `packages/client/ui-settings-subagent` and the subagent delegation card |
| `purposeRouting: true` and the shipping table | `standard.patch.yml` and anago-web's settings-row override |
| Upgrade guide | cursor/pi tool deletion, and the omitted-category child model change on anago-web |
| SDK expected outputs | TypeScript and Python projections of `subagent/purpose-route` |

Ship the settings section before enablement, so the table is editable when the flag turns on. Snapshot overlays that must record without a non-DeepSeek key map every category to a DeepSeek route. After refresh, schema-append diffs should be limited to scenarios that compose `preset-standard`. Any other scenario diff is a missed conditional append.

When this proposal ships, move this note to `implemented/` and rewrite it to the shipped decision. Until then it stays proposed.

## Alternatives considered

### Why not rewrite arguments before execute?

`tools/pre-execute` returns allow, deny, cancel, or ask. Input rewriting is excluded because arguments are already logged and presented ([`PreToolDecision`](../../../../packages/core/tools/src/index.ts)). A rewrite would also make the logged arguments diverge from the executed call, which breaks replay and audit.

### Why not one tool instance per purpose?

Instances such as `subagent_light` and `subagent_deep` keep routes in static `agentOptions`, so a settings edit cannot apply on the next call unless each instance grows its own volatile config and Session sample. The tool schema multiplies by six. A tool name cannot express fan-out. The settings card would edit six preset rows instead of one table.

### Why not replace the whole preset?

Overwriting `preset-standard`'s `config.plugins` from anago-web copies the upstream preset and drifts on every sync. The Web editor writes that same `config.plugins` list by id, so a wholesale overwrite collides with a user's preset edit. This proposal keeps the fork diff to `purposeRouting: true` on the live `tool-subagent` row, plus the settings-row overlay.

### Why not sample the category argument per Session?

Exposing `category` only when a table exists at Session composition would avoid a load failure in a profile that sets the flag without anago-web. It adds a second durable decision beside `selectForSession`, and the schema would differ per Session. A static flag plus load-time failure is simpler. Revisit only if the profile check under Risks finds many profiles that compose `preset-standard` without a table.

### Why not a fallback route?

A rejected draft gave every row a `fallback` route and added `fallback: true` so the parent could ask the runtime to start that route. Review's retry would have started one alternate child instead of fanning out. This proposal rejects that draft. There is no fallback parameter, no fallback field in the table, no `attempt` on the resolution or the event, and no runtime route switch. The parent re-delegates once with the same `category`, which for review fans out again over that slot's routes. A flag-selected alternate route is a second model the deployment must maintain, and it special-cases review. Provider outage and expired OAuth are reported, not escaped to another provider.

### Why not enforce retry with a child id now?

A `retry_of` argument naming the failed child would let the runtime reject a third attempt and a first call that claims to be a retry. The parent already judges an empty or unusable result, which a child id cannot classify. Add `retry_of` only if the unenforced convention is actually misused. It is not part of this proposal.

## Acceptance criteria

- A `purposeRouting: false` tool definition is byte-identical to today's definition and has no `category` property.
- A `purposeRouting: true` definition includes `category`, the pinned prose above, and no `fallback` property. The serialized definition contains none of the table's provider or model strings.
- Each named category resolves that row. Omitting `category` resolves `default`. `review` resolves every route in the row. `resolvePurposeRoutes` has no attempt argument.
- `assertPurposeRouteTable` rejects a second route on a non-review row, an empty list, and a duplicate triple. A missing slot fails schema validation.
- `category` combined with `provider`, with `reasoning_effort`, or with `model` is an error. A string outside the enum is an error.
- A category route absent from `allowedModels` still starts. The same route named explicitly is rejected. Effort-only explicit selection uses the `default` row and is subject to `allowedModels`.
- Category preflight always runs. The model-facing error omits provider and model names. The `not-started` event keeps the cause.
- A table edit between two calls affects only the later call. An edit during preflight does not affect the in-flight call. `purposeRoutes()` returns a detached copy and reflects a volatile update without rebuilding the plugin. The default is `null`.
- Review fan-out of three routes calls `startActivation` three times and records three events, with `subagentIds` listing all three. A failed second start yields `notStarted: 1` and leaves the others running. None started is an error. Abort during the start loop stops children already started.
- Load fails on each of the four misconfiguration conditions.
- A Loader-booted test `cordis.yml` with the settings plugin, `purposeRouting`, and two mock LLM providers shows the child Session created on the table route, the parent `subagent/purpose-route` event, and the model-visible schema.
- Keyless snapshots cover `purpose-routing-deep` and `purpose-routing-review-fanout` (the overlay gives `review` two routes). There is no fallback snapshot. Existing scenarios that embed `preset-standard` refresh only for that schema append.
- TypeScript and Python SDK expected outputs include the new event. `SESSION_FORMAT_VERSION` is unchanged, and the persistence type-change acknowledgement is recorded.
- One e2e delegation uses only `DEEPSEEK_API_KEY` and skips without it. Live xAI, Copilot, and opencode-go calls are out of scope.
- The settings controller rejects duplicates and unsupported efforts, the save payload is the whole table, and the null table renders the empty state. `verify-client-ui-i18n` passes. The UI change attaches a GIF recorded against the real server.
- The upgrade guide records the cursor/pi tool deletion and the omitted-category child-model change. Package README states the category meanings, the `allowedModels` exception, the added description tokens, that the enum is static so a table edit does not invalidate the prompt prefix, and that the retry count is not enforced.

## Risks

1. On anago-web, omitting `category` moves the child from parent inheritance to `opencode-go` / `deepseek-v4.1-flash`. Callers that expected the parent model change quality. The upgrade guide states that.
2. A profile that composes web-app `preset-standard` without anago-web, including a snapshot profile, fails load when the flag is set and the table is `null`. Before enablement, check every `dsh` profile and snapshot profile. Put a table on any overlay that needs the flag.
3. anago-web's top-level `tool-subagent` row overrides a disabled host-side row and sets `modelSelectionSettings: true`. Confirm that row is the live registration. If it is not, delete it at enablement. If it re-enables a second `subagent` tool, fix that double registration before setting `purposeRouting`.
4. Effort names such as `xhigh` on `grok-4.7` are defined by the adapter. A bad value fails every preflight. The UI blocks an unadvertised effort at save. Hand-edited YAML is detected only at the call.
5. Expired xAI or Copilot OAuth is not escaped to another provider. The same-category retry uses the same route. The delegation card's `reason` is how the user sees it. That is the cost of having no fallback route.
6. The runtime does not enforce one re-delegation. A parent can call again indefinitely, or change `category` to avoid a failure. The tool description forbids both. Enforcement, if it becomes necessary, is the rejected `retry_of` argument above.
7. A child persona may interpolate `{{model}}`, and a completion notice or `list_agents` may show a model name, so the parent can infer the route. The table itself stays hidden. At implementation, check those outputs. If they include the model name, decide whether `purposeRouting` hides it.
8. Confirm whether the child Session logs its effective route. If it does not, add that record, as the Session log section requires.
9. Adding reviewers can hit subagent limits and start only a prefix. The UI does not add a separate cap. Existing limits own the cap.
10. Shipping route values live only in the anago-web patch. A deployment that copies `purposeRouting: true` without a table fails load instead of inheriting a hardcoded route.
