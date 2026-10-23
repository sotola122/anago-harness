---
description: "Terminal UI application plugin for the anago harness, built on the pi terminal UI library."
kind: "package-reference"
---

# @anago-harness/tui

[English](README.md) | 中文

## 概述

anago 终端应用。它打开一个 DSH Agent，用 pi 终端 UI 渲染该 Session 的持久化记录：紧凑的工具卡片、默认折叠的推理块、流式助手文本与每回合 token 用量；它同时用模态对话框回答审批与用户提问瀑布。`/` 补全弹窗覆盖本 TUI 自己的命令，Ctrl+P 为后续回合切换 provider/model 路由，Ctrl+R 恢复已存 Session，Ctrl+O 展开最新的卡片。profile 行由 `anago-tui` bundle 持有，行为由本包实现。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

终端 profile 挂载两个行以及提问工具：

| 行 | 包 |
|---|---|
| `tui-startup` | `@anago-harness/tui/startup` |
| `tui-app` | `@anago-harness/tui` |
| `tool-ask-user` | `@deepseek-ai/dsh-tool-ask-user` |

在检出目录中启动：

```sh
pnpm dsh --profile tui
pnpm dsh --profile tui --resume <sessionId>
pnpm dsh --profile tui --inline --theme light
```

参数：

| 参数 | 含义 |
|---|---|
| `--resume <sessionId>` | 恢复已持久化的 Session，而不是新建。 |
| `--model <id>` | 本次运行覆盖配置的默认模型 id。 |
| `--provider <route>` | 本次运行覆盖配置的默认 provider 路由。 |
| `--theme <dark\|light>` | 本次运行的配色覆盖。 |
| `--inline` | 渲染到主屏幕并保留终端回滚；默认使用备用屏幕。 |

Agent 从配置的 `agentDefaultModel` provider 与模型启动；每个参数只替换它指定的那一半。既没有配置默认值，也没有完整的参数组合时，应用会向 stderr 写出一行，指明 `--provider`、`--model` 与 `agentDefaultModel`，然后在派发请求前以状态 1 退出。行配置中的 `theme` 与 `inline` 是参数覆盖的默认值。stdout 不是 TTY 时拒绝启动：写出一行说明交互终端要求与 `dsh --profile headless`，然后以状态 1 退出。

### 命令

在编辑器中输入 `/` 打开补全弹窗；Tab 或 Enter 接受高亮的命令名。命令在本地执行，不会发送给模型。

| 命令 | 行为 |
|---|---|
| `/help` | 在记录中列出命令与按键说明。 |
| `/model` | 打开模型选择器，列出 Host LLM 目录，并把选中的路由应用到后续回合。 |
| `/clear` | 关闭当前 Agent，并在同一界面中新建 Session。 |
| `/resume` | 列出该 profile 已存的 Session，并继续选中的那个；被其他进程持有的行会变暗并拒绝选中。 |
| `/quit` | 恢复终端并退出。 |

### 按键

| 按键 | 行为 |
|---|---|
| Enter | 提交。Agent 空闲时调用 `followup`，运行中调用 `steer`。 |
| Esc | 中断运行中的回合。模态中拒绝审批或推迟提问；也取消待确认的 Ctrl+C 退出。 |
| Ctrl+C | 第一次进入退出确认并显示提示；三秒内第二次恢复屏幕并退出。 |
| Ctrl+P | 打开 provider/model 选择器。 |
| Ctrl+R | 打开已存 Session 选择器。 |
| Ctrl+O | 展开或折叠最新的工具或推理卡片。 |
| Tab | 接受高亮的 `/` 命令补全。 |
| ↑ / ↓ | 在首行或末行时浏览编辑器历史；在模态列表或选择器中移动。 |
| Shift+Enter、Ctrl+Enter、Alt+Enter | 插入换行（取决于终端支持）。 |
| 方向键、Backspace、Delete、Ctrl+A/E/K/U/W | 编辑器移动与编辑。 |
| Enter、Esc | 在模态列表中确认或取消；对变暗的行按 Enter 只显示拒绝原因，不会选中。 |

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 — 点击展开</summary>

`src/startup.ts` 是 `tui-startup` 行。commander 命令声明参数族与 action，action 通过 `ctx.provide` 发布 `tuiStartup`；`@deepseek-ai/dsh-cmdline` 的 `parseCmdline` 执行该 action。非法的 `--theme` 或空 `--resume` 属于用法错误，不发布服务。

`src/index.ts` 是 `tui-app` 行。它立即注册审批与提问应答器，等待 `ctx.appReady.onReady(...)`，拒绝非 TTY stdout，按配置的默认模型创建或恢复 Agent（agent-loop 工厂尚未挂载时短暂重试），对恢复的 Session 通过投影重放记录，启动 pi-tui，并负责关闭。打开 Session 与之后的每次切换共用一条 `openInto` 路径：先打开新句柄，安装它的模型选择监听与事件订阅，重置记录与页脚，再释放上一个 Agent，并在恢复时重放历史。打开失败（包括 `--resume`）时，当前 Agent、其监听与记录保持不变。Session 切换被串行化，每个 await 都会重新检查共享的终止状态。`ProcessTerminal` 持有 stdin raw mode；每条退出路径都会先停止渲染器再调用 `ctx.appExit`。

行内的 `TuiHost` 回调把界面接到 DSH：`listModelOptions` 读取 LLM 目录，`resolveModelRoute` 校验选中的路由，`installModelSelection` 把它应用到活动 Agent 的后续提示词组装，`listSessionOptions` 读取与恢复重放相同的 `sessionQuery` 语料。

实现按层拆分，使多数测试不需要真实终端：

| 层 | 职责 |
|---|---|
| `src/projection/` | 从持久化 Session 事件到显示块的纯折叠，以及工具卡片、用量与推理投影。 |
| `src/host/` | DSH 访问：Agent 创建/恢复、输入投递、事件订阅、模型路由、Session 列表与两个瀑布应答器。 |
| `src/app/` | pi-tui 组合：记录、状态行、编辑器、命令补全、模态对话框、选择器与主题。 |
| `src/term/` | `ProcessTerminal` 连接点，以及 pi-tui 与 commander 的导入连接点。 |

记录只从已写入事件（`user/message`、`assistant/message`、`tool/call`、`tool/result`、`turn/start`、`turn/end`、`session/title`）与 `agent/assistant-stream` 文本/推理增量提供的瞬时缓冲区派生。恢复重放与实时更新使用同一投影；序号守卫使重复投递无害。块 id 来自 Session 序号。`applyTranscriptEvent` 从 `assistant/message` 读取推理块与 `usage`；`tool/result` 持久化的 `meta` 提供工作目录、读取窗口或 diff 统计等卡片事实，无法识别的负载回退到结果文本。

工具卡片显示工具名、单行调用摘要、`$ command` 之类的细节行、状态、耗时与折叠的结果预览。Ctrl+O 切换最新的工具或推理卡片。推理默认折叠为首行与字符数；仅当 provider 报告用量时，页脚才为当前或最近回合追加 `in … · out …`。模型选择器按 provider 分组列出目录模型，并随输入过滤；选中路由后会安装到 Agent 的模型选择监听上，无需重建 Agent。Session 选择器会把设置了 `disabledReason` 的行变暗，在细节栏显示该原因，并在按 Enter 时显示 `cannot select` 提示而不是打开它。

审批模态提供“允许一次”与“拒绝”。提问模态通过 `SelectList` 逐个问题渲染选项，并返回 `{ answers: [{ id, selected }] }`。无选项的问题或 Esc 会交给 `next()`，而不是凭空给出答案。面向其他 Agent 的请求会被委托，便于将来的多 Session 宿主。

测试位于 `tests/`，运行方式：

```sh
./node_modules/.bin/vitest run packages/fork/tui/tests
```

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [fork 分组](../README.zh.md) — 本分组的包地图。
- [`anago-tui`](../anago-tui/README.zh.md) — 挂载这些行的 bundle。
- [同捆插件设计](../../../ANAGO_PLUGINS_DESIGN.md) — 第 6 章即本插件的设计。

-----

<a id="model-experience"></a>
## 模型体验

无；终端 UI 仅向人类渲染 Session 状态，不贡献提示词、工具 schema 或 Session 事件。

#### KV Cache 影响

无；本包不改变系统提示词或稳定请求前缀的任何部分。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **启动路由必须来自 profile 或参数。** 既没有 `agentDefaultModel`，也没有完整的 `--provider`/`--model` 组合时，应用只写一行指引后退出，不会猜测 provider；`/model` 只能切到 Host LLM 目录公布的路由。
- **模型选择器只在当前会话生效，且没有推理控制。** 它不会把选中的路由保存为 profile 默认值，不提供 effort 选择，也会略过没有公布目录的 provider（当前路由除外）。
- **Session 切换只列头部元数据。** `/resume` 显示时间、目录与 id，最多列出最新的 50 个 Session，不显示标题，也不支持删除、重命名与搜索。
- **恢复重放依赖 `sessionQuery`。** 缺少该服务的 profile 会在恢复时向 stderr 报错而不是显示历史；`dsh-base` 已挂载该服务，因此随附的 `tui` profile 不受影响。
- **切换 Session 失败时保留当前 Agent。** `/resume` 与 `/clear` 先打开下一个 Agent，再释放当前的；打开失败时只显示错误，屏幕上已有的 Session 仍可继续使用。启动时的 `--resume` 失败仍以状态 1 退出，因为此时还没有打开的 Session。
- **禁用的 Session 行来自写入租约。** `listSessionOptions` 会为每个列出的 Session 探测 `SessionPersistence.ownership`；被另一个 DSH 进程持有的行会变暗并显示原因，且无法选中。该探测只是建议性的——如果在列出与打开之间丢失租约，同一条打开路径会拒绝它；对被持有的 Session 使用 `--resume` 会以相同原因退出。
- **工具卡片覆盖已知工具族。** `tool/result.meta` 只按结构读取路径、读取窗口、diff、任务与退出码；未知负载回退到结果文本。diff 只统计行数，不渲染 hunk；没有图片或语法高亮输出。
- **没有图片。** 不支持 `Image`、剪贴板图片粘贴与附件渲染；记录会忽略图片内容。
- **主题只有 dark 与 light，且在启动时选择。** 没有 `/theme` 切换、`SettingsList` 或自定义配色；dark/light 之外的主题延期。
- **没有鼠标滚动或选择。** 备用屏幕依赖 pi-tui 默认行为，没有 TUI 专用鼠标逻辑；主屏幕把滚动交给终端。
- **没有上下文或费用指标。** 只有 provider 报告用量时页脚才显示该回合的输入与输出 token；上下文 token、费用与每回合耗时缺席。
- **审批只支持一次性授权。** DSH 审批协议没有 Session 级授权，因此模态无法提供“本 Session 允许”；只有“允许一次”和“拒绝”。
- **提问只支持单选。** 多选问题只记录高亮选项，未实现自由文本（“其他”）回答。无选项的问题会委托给下一个应答器。
- **请求中止不会关闭已打开的模态。** `approval/request` 或 `user-questions/request` 被中止时，已打开的模态不会自动关闭。
- **斜杠命令只属于 TUI。** 仅存在 `/help`、`/model`、`/clear`、`/resume`、`/quit`；没有 `ctx.commands` 桥接、参数补全或 `@` 文件引用。
- **没有任务、子 Agent、目标、计划任务、压缩控制或命令桥。** 只渲染普通对话、工具卡片、推理、用量、错误与通知。
- **推理只是 provider 文本，不是思考界面。** 折叠摘要显示 provider 记录的内容；没有实时步骤时间线或逐步推理导航。
- **没有 Windows ConPTY 冒烟测试。** pi-tui 支持 win32，但本切片仅通过伪终端与非 TTY 路径测试。
- **只检查 stdout 的 TTY 状态。** stdin 被重定向而 stdout 是 TTY 时不会被拒绝。
- **依赖需要先安装。** `@earendil-works/pi-tui` 与 `commander` 已在 `package.json` 中声明，工作区的 `pnpm install` 负责建立链接；见开发备注。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

- 本包刻意没有 `cordis.patch.yml`；行由 `anago-tui` bundle 持有。
- `src/term/pi-tui.ts` 以裸说明符再导出 `@earendil-works/pi-tui`，`src/term/commander.ts` 以裸说明符再导出 `commander`。两者各自是唯一导入点，升级只需改一行和一条 lockfile 记录。从源码检出运行前需要 `pnpm install`（或等价的工作区链接）才能解析它们。
- 本包用 `./node_modules/.bin/tsc -p packages/fork/tui/tsconfig.json --emitDeclarationOnly --outDir /tmp/tui-types` 做类型检查。
- 审批与提问瀑布在行挂载时注册，但只有渲染器启动后才提供 presenter；因此过早的请求会被委托，而不会打开不可见模态。
- `turn/end` 的原因字段是唯一持久化的失败记录；`agent/error` 提供没有回合内位置的失败。两者都会成为错误行。
- 模型选择器在 Agent 作用域安装 `ModelSelectionRef`；该引用属于单个 Agent，因此切换 Session 会重新安装。路由不会写回 `agentDefaultModel`，避免一次 TUI 试验改变 profile 默认值。
</details>
