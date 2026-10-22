---
description: "Terminal UI application plugin for the anago harness, built on the pi terminal UI library."
kind: "package-reference"
---

# @anago-harness/tui

[English](README.md) | 中文

## 概述

anago 终端应用的第一个可用切片。它打开一个 DSH Agent，用 pi 终端 UI 渲染该 Session 的持久化记录，流式显示助手文本，在记录下方放置编辑器，并通过模态对话框回答审批与用户提问瀑布。profile 行由 `anago-tui` bundle 持有，行为由本包实现。

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

### 按键

| 按键 | 行为 |
|---|---|
| Enter | 提交。Agent 空闲时调用 `followup`，运行中调用 `steer`。 |
| Esc | 中断运行中的回合。模态中拒绝审批或推迟提问；也取消待确认的 Ctrl+C 退出。 |
| Ctrl+C | 第一次进入退出确认并显示提示；三秒内第二次恢复屏幕并退出。 |
| ↑ / ↓ | 在首行或末行时浏览编辑器历史。 |
| Shift+Enter、Ctrl+Enter、Alt+Enter | 插入换行（取决于终端支持）。 |
| 方向键、Backspace、Delete、Ctrl+A/E/K/U/W | 编辑器移动与编辑。 |
| 方向键、Enter、Esc | 在模态列表中移动与选择。 |

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 — 点击展开</summary>

`src/startup.ts` 是 `tui-startup` 行。commander 命令声明参数族与 action，action 通过 `ctx.provide` 发布 `tuiStartup`；`@deepseek-ai/dsh-cmdline` 的 `parseCmdline` 执行该 action。非法的 `--theme` 或空 `--resume` 属于用法错误，不发布服务。

`src/index.ts` 是 `tui-app` 行。它立即注册审批与提问应答器，等待 `ctx.appReady.onReady(...)`，拒绝非 TTY stdout，按配置的默认模型创建或恢复 Agent（agent-loop 工厂尚未挂载时短暂重试），对恢复的 Session 通过投影重放记录，启动 pi-tui，并负责关闭。恢复重放通过 `sessionQuery.readSession` 读取持久化历史；该服务由 `dsh-base` 挂载。disposer、SIGINT/SIGTERM 与 boot 路径共享同一个终止状态；`boot()` 中的每个 await 都会重新检查该状态，因此落在打开或重放期间的关闭不会让 `ui.start()` 取得终端。`ProcessTerminal` 持有 stdin raw mode；每条退出路径都会先停止渲染器再调用 `ctx.appExit`。

实现按层拆分，使多数测试不需要真实终端：

| 层 | 职责 |
|---|---|
| `src/projection/` | 从持久化 Session 事件到显示块的纯折叠，以及工具调用/结果摘要。 |
| `src/host/` | DSH 访问：Agent 创建/恢复、输入投递、事件订阅、两个瀑布应答器。 |
| `src/app/` | pi-tui 组合：记录、状态行、编辑器、模态对话框与主题。 |
| `src/term/` | `ProcessTerminal` 连接点，以及 pi-tui 与 commander 的导入连接点。 |

记录只从已写入事件（`user/message`、`assistant/message`、`tool/call`、`tool/result`、`turn/start`、`turn/end`、`session/title`）与 `agent/assistant-stream` 提供的瞬时文本缓冲区派生。恢复重放与实时更新使用同一投影；序号守卫使重复投递无害。块 id 来自 Session 序号。

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

- **未实现工具卡片。** 记录只显示工具名、单行参数摘要与结果首行；没有可展开卡片、diff、耗时或 `presentationMeta` 投影。
- **没有模型或 provider 选择器。** 配置的默认值与 `--model`/`--provider` 只设置 Agent 启动值；会话中切换路由需要重启。
- **模型路由必须来自 profile 或参数。** 既没有 `agentDefaultModel`，也没有完整的 `--provider`/`--model` 组合时，应用只写一行指引后退出，不会猜测 provider。
- **没有 Session 选择器。** 只能通过 `--resume <sessionId>` 重新打开 Session；列表、删除与切换均未实现。
- **恢复重放依赖 `sessionQuery`。** 缺少该服务的 profile 会在恢复时向 stderr 报错而不是显示历史；`dsh-base` 已挂载该服务，因此随附的 `tui` profile 不受影响。
- **没有图片。** 不支持 `Image`、剪贴板图片粘贴与附件渲染；记录会忽略图片内容。
- **主题只有 dark 与 light，且在启动时选择。** 没有 `/theme` 切换、`SettingsList` 或自定义配色；dark/light 之外的主题延期。
- **没有鼠标滚动或选择。** 备用屏幕依赖 pi-tui 默认行为，没有 TUI 专用鼠标逻辑；主屏幕把滚动交给终端。
- **没有指标。** 不显示上下文 token、费用、用量或每回合耗时。
- **审批只支持一次性授权。** DSH 审批协议没有 Session 级授权，因此模态无法提供“本 Session 允许”；只有“允许一次”和“拒绝”。
- **提问只支持单选。** 多选问题只记录高亮选项，未实现自由文本（“其他”）回答。无选项的问题会委托给下一个应答器。
- **请求中止不会关闭已打开的模态。** `approval/request` 或 `user-questions/request` 被中止时，已打开的模态不会自动关闭。
- **没有斜杠命令、补全或 `@` 文件引用。** 编辑器只有内置历史与粘贴标记，没有命令或路径 provider。
- **没有推论块、任务、子 Agent、目标、计划任务、压缩控制或命令桥。** 只渲染普通对话、工具、错误与通知。
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
</details>
