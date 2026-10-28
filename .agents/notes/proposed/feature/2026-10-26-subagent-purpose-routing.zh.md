# Agent Note: subagent 用途路由

Status: proposed

[English](2026-10-26-subagent-purpose-routing.md) | 中文

## 问题

父模型选择子模型的方式，是指名 `provider`、`model` 与 `reasoning_effort`，或者省略它们并继承父级 route 或工具实例的静态 `agentOptions`。部署若希望查找、实现、设计、评审或文章使用不同的子模型，没有可传递的用途标签。把提供方名和模型名写进提示词，会公开随部署而变的 route。按用途拆成多个工具实例，会把每条 route 冻在静态 `agentOptions` 里，因此不新建 Session 就无法让设置编辑作用于下一次委派。

评审在相反方向上有同一缺口。一次 `subagent` 调用只启动一个 child。部署若要多个 reviewer，就必须多次调用并逐个指名 route。

[用户授权的 subagent 模型路由](../../implemented/feature/2026-08-24-user-authorized-subagent-model-routes.zh.md)把 `allowedModels` 冻结在 Session 组合时，这是正确的，因为设置编辑不得静默改变运行中 Session 对模型可见的授权。该规则并没有给部署一张可编辑、且下一次委派就生效的用途表。失败处理也仍是开放的：child 未能启动、以错误结束或返回不可用结果时，由父模型决定是否再试，而运行时无法判断后一次调用是不是同一任务。

anago-core 仍在[其 patch](../../../../packages/fork/anago-core/cordis.patch.yml)中插入 Cursor 与 Pi 的 subagent 行（`subagent-cursor`、`tool-subagent-cursor`、`subagent-pi`、`tool-subagent-pi`）。这些行是带 `providerOwnedRoute` 的另一条产品路径，不是用途标签。在加入用途路由时把它们留在原地，会把两项工具目录变更混在一起。

## 提案

当 `subagent` 实例设置 `purposeRouting: true` 时，父模型只传递封闭的用途标签 `category`，运行时从该次调用读取的 Host 用途表解析子 route。父模型看不到提供方名、模型名或这张表。`list_subagent_models` 也不列出这张表。没有 fallback 参数，没有按用途配置的 fallback route，也没有运行时的 route 切换。child 若未能启动、以错误结束或返回不可用结果，父模型用同一个 `category` 再委派一次——失败的调用省略了 `category` 时，再次省略——若第二次调用也失败，则向用户报告。

`category: "review"` 为该行配置的每条 route 启动一个 child，并返回 `subagentIds` 与 `notStarted`。其他 category 恰好启动一个 child。

用途表在现有的 subagent 设置卡片上编辑，并从下一次委派起生效。`allowedModels` 仍是 Session 快照。本提案不重开该决定：显式的 `provider` / `model` / `reasoning_effort` 选择仍受允许列表约束。route 参数、适配器预检与发现工具仍由[模型选择的 subagent 路由](../../../../packages/subagent/tool-subagent/README.zh.md)负责。

### 非目的

- 在同一次调用内切换到另一条 route。
- 向模型披露用途表。
- 按 category 切换人格或工具集合。`agent_preset` 与 `category` 保持独立。
- 把 `category` 用于 `subagent_fork`、`workflow-ptc` 或外部 CLI 提供方。
- 用户自定义 category。集合是封闭的。
- TUI 编辑界面、成本计量或预算控制。

### 类别与用途表

新模块 `packages/subagent/tool-subagent/src/purpose-routing.ts`：

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

`default` 不是面向模型的 enum 值。省略 `category` 即选中该行。同时接受省略和 `"default"` 会让同一种选择有两种写法。

表是六个必填 slot 的封闭对象。缺行会在 Schemastery 验证时失败，因此运行时不会出现。`assertPurposeRouteTable` 拒绝空列表、`FAN_OUT_SLOTS` 以外的 slot 上多于一条 route，以及同一 slot 内重复的 provider/model/effort 三元组。每条 route 的 `reasoningEffort` 必填，这样模型变更时不会静默继承父级 effort，也不会落到模型默认值。

一行就是 route 列表本身。表中没有包装对象，也没有 fallback 字段。

### Host 设置与加载检查

在 `packages/subagent/tool-subagent/src/model-selection-settings.ts` 的 `SubagentModelSelectionConfig` 上增加一个 volatile 字段：

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

`current()` 仍在 Session 组合时对 `enabled` 与 `allowedModels` 取样一次。`purposeRoutes()` 在每次委派时读取当前值。两者都放在 profile entry `subagent-model-selection-settings` 上，因为 Web 表单已经绑定该 id，不必再拆一张卡片。通用插件的默认值是 `null`。具体 route 随部署而变，因此插件代码不写死它们。

`packages/subagent/tool-subagent/src/index.ts` 增加 `purposeRouting?: boolean`，schema 为 `z.boolean().default(false)`。下列任一成立时，加载立即失败：

- `purposeRouting: true`，且 Host scope 没有 `subagentModelSelection` 服务。
- `purposeRouting: true`，且 `settings.purposeRoutes()` 为 `null`。
- `purposeRouting: true`，同时又指定了 `agentOptions.provider`、`agentOptions.model` 或 `agentOptions.reasoningEffort`。`maxTokens` 可以并用。
- `purposeRouting: true` 与 `providerOwnedRoute: true` 并用，仅当下方 Cursor 与 Pi 退役后该字段仍存在时。

解析结果不带尝试种类：

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

既有路径是 `children.length === 1` 的同一种结果，因此 execute 用一个循环启动 child。

出厂表是 [anago-web 的 patch](../../../../packages/fork/anago-web/cordis.patch.yml)里对 `subagent-model-selection-settings` 的 id 覆盖。这些主 route 是提议的部署值。插件代码不拥有它们。

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

`purposeRouting: true` 是实际提供 `subagent` 的那一行 `tool-subagent` 上的一个字段。该行是 [standard.patch.yml](../../../../packages/bundle/web-app/presets/standard.patch.yml) 中的 `preset-standard` 条目。anago-web 顶层的 `tool-subagent` 行是另一项注册问题，记在风险中；不要在两行都会注册 `subagent` 的配置上同时打开该标志。

兼容：

- 既没有 `purposeRoutes` 也没有 `purposeRouting` 的 profile 保持当前行为。字段默认 `null`。
- 过去的调用没有 `category`。恢复之后，新调用使用更新后的工具 schema，与其他工具目录更新相同。
- 下方的新事件为 `ignorable: true`。不要提升 `SESSION_FORMAT_VERSION`。
- 在 anago-web 上，省略 `category` 的委派使用 `default` 行，而不再继承父级 route。把这一点记入升级指南。

### 工具 schema

只有 `purposeRouting: true` 的实例增加参数。`purposeRouting: false` 的实例保持说明文字和既有参数文字逐字节不变。category 文字只追加在启用的实例上。

| 参数 | 类型 | 必填 |
|---|---|---|
| `category` | 字符串 enum：`light`、`medium`、`deep`、`review`、`writing` | 否 |

没有 `fallback` 参数。

面向模型的文字为英文，并由快照逐字固定。在工具说明末尾追加这句话：

```text
Choose `category` to match the task; the runtime picks a suitable child model for it. Omit `category` for general work. If a subagent fails to start, ends with an error, or returns an unusable result, re-delegate the same task once with the same `category`. If the failed call omitted `category`, omit it again. If that also fails, stop retrying and report the failure.
```

`category`：

```text
Task purpose that selects the child model. `light`: quick lookups, small mechanical edits, short summaries. `medium`: ordinary implementation or investigation. `deep`: hard debugging, design, or long multi-step reasoning. `review`: independent review of a change, plan, or document; may start several reviewers in parallel, each reporting separately. `writing`: documentation, PR or issue text, translation, user-facing prose. Do not combine with `provider`, `model`, or `reasoning_effort`.
```

当 Session 启用了模型选择策略时，在既有的 `provider`、`model` 与 `reasoning_effort` 说明末尾追加 `Do not combine with \`category\`.`，且仅在 `purposeRouting` 为 true 时追加。面向模型的字符串不出现提供方名、模型名、路由表或 settings。

互斥：

- `category` 不能与 `provider`、`model` 或 `reasoning_effort` 并用。effort 由该行决定，因此包含在互斥中。
- `agent_preset` 与 `cwd` 可以与 `category` 并用。
- 省略 `category` 是合法的。它选中 `default` 行。

输出字段：

```text
properties: {
  kind: { const: 'activation', required: true },
  subagentId: { type: 'string', required: true }, // first started child; existing readers keep this field
  subagentIds: { type: 'array', items: { type: 'string' } }, // review only; includes subagentId first
  notStarted: { type: 'integer' }, // review only; reviewers that did not start
}
```

渲染：

- 启动了一个 child，且 `notStarted` 缺席或为零：`started subagent <id>`（不变）。
- review 启动了多于一个 child，或 review 的 `notStarted > 0`：`started 3 subagents: <id1>, <id2>, <id3>`，当 `notStarted > 0` 时再接 `; 1 reviewer could not start`。

保留 `subagentId`，是因为已持久化的工具结果和现有 Web 卡片只读这个字段。review 行始终包含 `subagentIds` 与 `notStarted`，包括只有一条 route 且 `notStarted: 0` 的行。

错误在 `execute` 内抛出，并作为工具错误返回。参数在 execute 之前冻结，并留在日志中。

| 条件 | 判定位置 | 面向模型的结果 |
|---|---|---|
| `category` 与 route 参数并用 | 解析开头 | `` `category` cannot be combined with `provider`, `model`, or `reasoning_effort` `` |
| `category` 不在 enum 内 | 执行器的 JSON 验证与 resolver | `` unknown category "x"; use light, medium, deep, review, or writing, or omit it `` |
| `purposeRouting` 为 false 时仍出现 `category` | resolver | `category selection is not available for this tool` |
| 调用时表为 `null`，或设置服务缺失 | resolver | `no child model is configured for this tool; report that to the user` |
| 选中的每条 route 都在预检或启动时失败 | 预检之后或启动循环之后 | `` the model for category `deep` is unavailable; re-delegate once with the same `category` `` |

失败的调用省略了 `category` 时，最后一行改为要求不带 `category` 再委派一次，并且不提及 `default`。预检和启动失败的原因包含提供方与模型。该原因不返回给模型，只留在下方事件和 Host logger 中。

### 解析

把纯函数 `resolvePurposeRoutes(table, slot)` 与 execute 过程分开。`resolvePurposeRoutes` 返回 `table[slot]`，不接受尝试参数。

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

优先级：显式 route 参数 > `category`（省略则选 `default`）> `config.agentOptions`（除 `maxTokens` 外，route 字段不能在加载时与 `purposeRouting` 共存）> 提供方的 route 默认值 > 父级继承。

在 `purposeRouting: true` 时，只设置 `reasoning_effort` 的调用使用 `default` 行的 provider 与 model，并替换 effort。该行是已配置 child 默认值这一层。

每次 execute 在 fan-out 之前读表一次，因此调用进行中的编辑不会改变它。不在 apply 时捕获服务。每次调用用 `runtimeCtx.get('subagentModelSelection')`，以免设置插件被替换后仍读到旧实例。

未知 category 是错误，不会改写成 `default`。schema 下不会出现缺行。表为 `null` 或服务缺失是调用时错误。加载检查通常会先拦住；手改的 profile 或加载后的替换仍可能到达调用。

`allowedModels` 只限制显式 route 选择。category 调用的授权依据是用户编写的表；模型选择的只是标签。这与「已配置的默认值不经策略检查」的既有规则相同。预检仍然执行。例外是只指定 effort 的显式选择：基准 route 是 `default` 行，该 route 不在 `allowedModels` 内时拒绝。把这一点写进包 README。

### 设置卡片与委派卡片

在 `packages/client/ui-settings-subagent` 下增加 `SubagentPurposeRoutesFields.tsx`、其 CSS module 和 `subagent-purpose-routes-card-controller.ts`，并在 `SubagentCard.tsx` 的 Limits 与模型选择之后挂一个分区。

分区是六行，顺序与 `PURPOSE_ROUTE_SLOTS` 相同。

| 列 | 内容 |
|---|---|
| 用途 | 本地化标签（轻量、标准、熟考、评审、文章、默认）和一行说明 |
| Routes | provider/model 选择器与 effort 选择。只有 `review` 显示添加和删除。该行不能少于一条 route |

没有 fallback 列，也没有「使用 fallback」开关。provider 与 model 的候选项复用 `SubagentModelSelectionFields` 的选择器和目录路径。effort 候选项是所选模型公布的 effort。分区说明表的编辑从下一次委派起生效，而 `allowedModels` 仍只作用于新组合的 Session。

窄宽度下每行纵向堆叠。客户端在必填项缺失、`review` 上出现重复三元组，或所选模型未公布该 effort 时阻止保存。未注册或未认证的提供方只警告，仍允许保存，以免挡住日后的 OAuth 登录。Schemastery 与 `assertPurposeRouteTable` 是最终判定。保存被拒绝时，使用现有卡片的错误位置。保存载荷是整个 `purposeRoutes` 值，路径与 `allowedModels` 的 profile entry 相同。没有按行写入。

文案放在类型化的 `locales.ts` 字典中，并经过 `t`。键：

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

Host 返回 `purposeRoutes: null` 时，显示空状态，不放初始化按钮。出厂表属于 anago-web。设置服务本身不存在时，像现有卡片一样不显示该分区。

委派卡片由原始事件 `subagent/purpose-route` 和已持久化的 `subagentIds` 组成。它显示用途标签、实际使用的 provider/model/effort，以及每个已启动 child 的链接。未能启动的 route 把事件的 `reason` 显示给用户。这是对模型隐瞒的原因。卡片不显示主/fallback 之别，因为表中没有 fallback route。

### 会话日志

`category` 由既有的参数日志在 execute 之前冻结。向父 Session 追加一条仅日志事件，无 `surfaceOp`，且 `ignorable: true`：

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

在该 child 的结果提交时追加：`startActivation` 成功后写 `started`，失败结算后写 `not-started`。`outcome` 是封闭 union；读取方以 `assertNever` 收尾。事件没有 attempt 字段。

父模型可见的输入是工具 schema、参数、工具结果和完成通知。schema 来自静态 Config。参数、结果和通知已经在日志中。route 对父模型不可见，因此这条事件不是为了满足该日志规则。它的用途是在表被编辑之后，仍能供审计和委派卡片恢复 route。child 的模型请求由 child Session 自己的日志再现。若该日志尚未记录有效 route，同一次变更补上该记录。

向 `SessionEventMap` 增加成员时，遵循[持久化类型变更评审](../../../../docs/cookbook/reviewing-persistence-type-changes.zh.md)。同一次变更更新 TypeScript 与 Python SDK 的预期输出。不改 `subagent/model-selection-policy`。`provider` 与 `model` 参数是否可见，仍由该事件决定。

### 同一 category 的再委派

工具说明陈述再试规则。运行时无法判断后一次调用是不是同一任务，因此不强制次数。

| 发生了什么 | 算失败吗 | 父模型的行动 |
|---|---|---|
| 工具错误（预检或启动失败） | 是 | 用同一个 `category` 再委派一次；失败的调用省略了它，则再次省略 |
| 完成通知处于错误状态（提供方错误、认证过期、速率限制） | 是 | 同上 |
| 已完成，但结果为空或不可用 | 父模型可以把它当作失败 | 同上 |
| 用户中断或停止，包括启动循环中的中断 | 否 | 不再委派 |
| 第二次调用也失败 | — | 停止再试并报告。不要为了避开失败而改 `category` |

上限是每个任务再委派一次，合计两次调用。它不是数值设置。表中没有第二条 route，因此再试使用后一次调用时该 slot 所配置的 route。

### 评审 fan-out

一次 `category: "review"` 调用为每条 `review` route 启动一个 child，使用相同的 `prompt`。完成通知按 child 分别到达。父模型等待每个 reviewer 的完成通知，然后综合，并写明意见分歧之处。

至少启动了一个 child 的 review 调用是成功的工具结果。`subagentIds` 列出已启动的 child，`subagentId` 在首位，`notStarted` 计其余未能启动的数量。这次调用不启动第二波。若已启动的 reviewer 后来以错误结束，或父模型判定这组结果不可用，父模型可以用 `category: "review"` 再委派一次。后一次调用按当时配置的 route 再次 fan-out。它不停止已经启动的 child。若后一次调用也失败，保留已经在手的 reviewer 结果，并报告覆盖范围缩小。

运行时启动规则：

1. 按表的顺序逐条预检每条选中的 route，使事件顺序确定。
2. 对通过预检的 route 按同一顺序 `startActivation`。
3. 部分失败：不停止已经启动的 child。用 `subagentIds` 与 `notStarted` 报告。一个都没启动则返回工具错误。
4. 启动循环中中断（`exec.signal`）：通过 subagents 服务停止已经启动的 child，再返回中断错误，以免已启动的 child 没有父模型可见的 id。停止操作的名称在实现时确认。
5. 并发上限仍由既有的 subagent limits 负责。因上限而拒绝启动算部分失败。

### Cursor 与 Pi 的退役

先于路由变更交付退役，使路由的快照差异只剩 category 变更。

1. 从 [anago-core 的 patch](../../../../packages/fork/anago-core/cordis.patch.yml) 删除 `subagent-cursor`、`tool-subagent-cursor`、`subagent-pi` 与 `tool-subagent-pi`，并从 anago-core 的 `package.json` 去掉对应依赖。
2. `@anago-harness/subagent-cursor` 与 `@anago-harness/subagent-pi` 不再有产品使用者后，`scripts/product-package-policy.ts` 会拒绝它们。若没有其他使用者，在同一次变更中删除这两个包。不要为了保留它们而增加分类。
3. 若 cursor 与 pi 是 `providerOwnedRoute` 和 `providerOwnedAgentOptions` 的仅有使用者，则删除这两个字段。检查 fixture，包括 `packages/subagent/subagent-dsh-sdk/tests/fixtures/loader/dsh-sdk.patch.yml`。删除之后，路由的 execute 没有 `providerOwnedRoute` 分支。若字段保留，则保留上方的加载时互斥检查。
4. 把点名 `subagent_cursor` 或 `subagent_pi` 的 TUI 文档和注释改成当前描述。保留跨进程 Session lease：空闲 Agent 交还写入所有权，使另一进程可以打开同一 Session。
5. 在升级指南中记录工具删除。
6. 重新生成目录包含 anago-core 的快照。

cursor 与 pi 行是另一个工具实例。它们与用途路由不相互影响。先退役它们，使该项删除不进入路由评审。

### 交付

| 变更 | 所在 |
|---|---|
| Cursor 与 Pi 退役 | anago-core patch 与包依赖；删除不再使用的包 |
| 类型、schema、resolver、条件参数、事件、启动循环、测试、README | `packages/subagent/tool-subagent` |
| 设置分区与委派卡片 | `packages/client/ui-settings-subagent` 与 subagent 委派卡片 |
| `purposeRouting: true` 与出厂表 | `standard.patch.yml` 与 anago-web 的设置行覆盖 |
| 升级指南 | cursor/pi 工具删除，以及 anago-web 上省略 category 时子模型的变更 |
| SDK 预期输出 | `subagent/purpose-route` 的 TypeScript 与 Python 投影 |

先交付设置分区，再启用，这样标志打开时表已经可以编辑。必须在没有非 DeepSeek 密钥时记录的快照 overlay，把每个 category 映射到 DeepSeek route。refresh 之后，schema 追加差异应只出现在组成 `preset-standard` 的场景中。其他场景出现差异，就是条件追加漏了。

本提案交付后，把本 Agent Note 移到 `implemented/`，并改写成已交付的决定。在此之前它保持 proposed。

## 考虑过的替代方案

### 为什么不在 execute 之前改写参数？

`tools/pre-execute` 的结果是 allow、deny、cancel 或 ask。输入改写被排除，因为参数已经记入日志并呈现（[`PreToolDecision`](../../../../packages/core/tools/src/index.ts)）。改写还会使日志中的参数与实际执行的调用不一致，从而破坏回放和审计。

### 为什么不按用途各做一个工具实例？

`subagent_light`、`subagent_deep` 这类实例把 route 放在静态 `agentOptions` 中，因此除非每个实例各自增加 volatile 配置和 Session 取样，设置编辑无法作用于下一次调用。工具 schema 会变成六倍。工具名表达不了 fan-out。设置卡片会去编辑六行 preset，而不是一张表。

### 为什么不整体替换 preset？

从 anago-web 覆盖 `preset-standard` 的 `config.plugins`，会复制上游 preset，并在每次同步时漂移。Web 编辑器也按 id 写同一份 `config.plugins` 列表，整体覆盖会与用户的 preset 编辑冲突。本提案把 fork 侧差异限制为活动 `tool-subagent` 行上的 `purposeRouting: true`，再加上设置行覆盖。

### 为什么不按 Session 取样是否暴露 category 参数？

只在 Session 组合时存在表才暴露 `category`，可以避免「设置了标志但没有 anago-web」的 profile 在加载时失败。这会在 `selectForSession` 旁边增加第二项持久决定，并且 schema 会随 Session 而变。静态标志加上加载时失败更简单。只有当风险一节中的 profile 检查发现许多 profile 在没有表的情况下组成 `preset-standard` 时，才重新考虑。

### 为什么不要 fallback route？

被否决的草稿给每一行一个 `fallback` route，并增加 `fallback: true`，让父模型要求运行时启动该 route。review 的再试会启动一个替代 child，而不是 fan-out。本提案否决该草稿。没有 fallback 参数，表中没有 fallback 字段，解析结果和事件上没有 `attempt`，也没有运行时的 route 切换。父模型用同一个 `category` 再委派一次；对 review 而言，这会按该 slot 的 route 再次 fan-out。由标志选中的替代 route 是部署必须维护的第二个模型，并且会把 review 当成特例。提供方中断和过期的 OAuth 被报告，而不是逃到另一个提供方。

### 为什么现在不用 child id 强制再试？

名为 `retry_of`、指向失败 child 的参数，可以让运行时拒绝第三次尝试，以及一开始就声称自己是再试的调用。父模型已经判断空结果或不可用结果，child id 无法分类这类结果。只有在未强制的约定确实被误用时，才增加 `retry_of`。它不属于本提案。

## 验收标准

- `purposeRouting: false` 的工具定义与当前定义逐字节相同，且没有 `category` 属性。
- `purposeRouting: true` 的定义包含 `category`、上方逐字固定的说明，且没有 `fallback` 属性。序列化后的定义不包含表中的任何 provider 或 model 字符串。
- 每个具名 category 解析到该行。省略 `category` 解析到 `default`。`review` 解析该行的每一条 route。`resolvePurposeRoutes` 没有尝试参数。
- `assertPurposeRouteTable` 拒绝非 review 行上的第二条 route、空列表和重复三元组。缺 slot 时 schema 验证失败。
- `category` 与 `provider`、与 `reasoning_effort` 或与 `model` 并用都是错误。enum 外的字符串是错误。
- 不在 `allowedModels` 中的 category route 仍能启动。同一 route 被显式指名时被拒绝。只指定 effort 的显式选择使用 `default` 行，并受 `allowedModels` 约束。
- category 路径始终执行预检。面向模型的错误不含 provider 名和 model 名。`not-started` 事件保留原因。
- 两次调用之间的表编辑只影响后一次调用。预检期间的编辑不影响进行中的调用。`purposeRoutes()` 返回脱离的副本，并且不重建插件就能反映 volatile 更新。默认值是 `null`。
- 三条 route 的 review fan-out 调用 `startActivation` 三次并记录三条事件，`subagentIds` 列出全部三条。第二次启动失败时 `notStarted: 1`，其余 child 继续。一个都没启动则是错误。启动循环中的中断会停止已经启动的 child。
- 四种错误配置各自导致加载失败。
- 用 Loader 启动的测试 `cordis.yml` 包含设置插件、`purposeRouting` 和两个 mock LLM 提供方，并表明 child Session 按表中的 route 创建、父 Session 记录 `subagent/purpose-route`，以及面向模型的 schema 符合预期。
- 无需密钥的快照覆盖 `purpose-routing-deep` 与 `purpose-routing-review-fanout`（overlay 给 `review` 两条 route）。没有 fallback 快照。嵌入 `preset-standard` 的既有场景只为该 schema 追加而 refresh。
- TypeScript 与 Python SDK 的预期输出包含新事件。`SESSION_FORMAT_VERSION` 不变，并记录持久化类型变更确认。
- 一条 e2e 委派只使用 `DEEPSEEK_API_KEY`，没有密钥时跳过。xAI、Copilot 与 opencode-go 的实 API 调用不在范围内。
- 设置控制器拒绝重复项和不支持的 effort，保存载荷是整张表，`null` 表渲染空状态。`verify-client-ui-i18n` 通过。UI 变更附上对着真实服务器录制的 GIF。
- 升级指南记录 cursor/pi 工具删除，以及省略 category 时子模型的变更。包 README 写明 category 的含义、`allowedModels` 例外、增加的说明 token、enum 是静态的因而编辑表不会使提示词前缀失效，以及再试次数不被强制。

## 风险

1. 在 anago-web 上，省略 `category` 会使 child 从继承父模型变为 `opencode-go` / `deepseek-v4.1-flash`。期望父模型的用法会改变质量。升级指南说明这一点。
2. 组成 web-app `preset-standard` 但没有 anago-web 的 profile，包括快照 profile，在标志已设置且表为 `null` 时会加载失败。启用之前检查每个 `dsh` profile 和快照 profile。需要该标志的 overlay 都放上一张表。
3. anago-web 顶层的 `tool-subagent` 行覆盖一条被禁用的 host 侧行，并设置 `modelSelectionSettings: true`。确认该行是实际生效的注册。若不是，在启用时删除它。若它重新启用了第二个 `subagent` 工具，先修好双重注册，再设置 `purposeRouting`。
4. `grok-4.7` 上的 `xhigh` 等 effort 名由适配器定义。非法值会使每次预检失败。UI 在保存时拦住未公布的 effort。手改的 YAML 要到调用时才被发现。
5. 过期的 xAI 或 Copilot OAuth 不会逃到另一个提供方。同一 category 的再委派使用同一条 route。用户通过委派卡片的 `reason` 看到这一点。这是没有 fallback route 的代价。
6. 运行时不强制只再委派一次。父模型可以无限再次调用，或改 `category` 来避开失败。工具说明禁止两者。若确需强制，采用上方被否决的 `retry_of` 参数。
7. child 人格可能插入 `{{model}}`，完成通知或 `list_agents` 可能显示模型名，于是父模型可以推断 route。表本身仍然隐藏。实现时检查这些输出。若其中包含模型名，再决定 `purposeRouting` 下是否隐藏它。
8. 确认 child Session 是否记录自己的有效 route。若没有，按会话日志一节的要求补上该记录。
9. 增加 reviewer 可能触及 subagent limits，从而只启动前缀。UI 不另设上限。既有 limits 拥有该上限。
10. 出厂 route 值只存在于 anago-web 的 patch 中。只复制 `purposeRouting: true` 而不提供表的部署会加载失败，而不是继承写死的 route。
