---
description: "Cursor Agent CLI one-shot subagent provider for the DSH subagent seam."
kind: "package-reference"
---

# @anago-harness/subagent-cursor

[English](README.md) | 中文

## 概述

`@anago-harness/subagent-cursor` 向 DSH 的 subagent seam 注册一个名为 `cursor` 的一次性外部子代理提供方。每次被接受的委派都会在委派 Session 的工作区中启动且仅启动一个 `agent --print` 子进程，并把可解析、非错误的 JSON 负载（或干净的 `--output-format text` 运行）映射为 `completed`。

模型可见的 `subagent_cursor` 工具不属于本包。`anago-core` 捆绑包通过上游 `@deepseek-ai/dsh-tool-subagent` 行（`provider: cursor`、`maxDepth: provider-managed`）添加该工具；本包只负责提供方。

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

行由捆绑包持有，因此本包没有 `cordis.patch.yml`。在组合捆绑包中加入两行：

```yaml
- id: subagent-cursor
  name: '@anago-harness/subagent-cursor'
- id: tool-subagent-cursor
  name: '@deepseek-ai/dsh-tool-subagent'
  config:
    provider: cursor
    toolName: subagent_cursor
    maxDepth: provider-managed
```

本包依赖 `subagents` 和 `subprocess` 服务。Cursor CLI（`agent`）必须位于子进程的 `PATH` 中，或由 `agentBinary` 指定；解析失败会拒绝 `start()`，绝不会隐式回退到其他二进制。

### 配置

在 `subagent-cursor` 行上设置 `config`。凡是自包含的校验都在插件加载时完成；非法的时间或字节上限会抛错，而不是被静默截断。

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `providerName` | `cursor` | `ctx.subagents` 中的注册名；同一组合内必须唯一。 |
| `agentBinary` | `agent` | 通过 `ctx.subprocess.resolveExecutable` 解析的 Cursor CLI 可执行文件。 |
| `model` | （未设置） | `--model` 的值；未设置时使用 CLI 默认值。 |
| `outputFormat` | `json` | `--output-format` 的值。`text` 把退出码为 0 的原始 stdout 直接视为成功，并跳过 JSON 解析。 |
| `mode` | `agent` | `agent` 不发送 `--mode`。`ask` 和 `plan` 是 CLI 的只读模式。 |
| `sandbox` | `true` | 发送 `--sandbox enabled`；`false`（仅诊断）发送 `--sandbox disabled`。 |
| `force` | `false` | 发送 `--force`（Run Everything）；默认关闭。 |
| `trust` | `true` | 发送 `--trust`，跳过 print 模式的工作区信任提示。 |
| `timeoutMs` | `600000` | 单次运行的挂钟预算。必须为正有限值且不超过 `2147483647`；非法值抛错。 |
| `disposeGraceMs` | `3000` | 交给 subprocess 提供方的 SIGTERM 到 SIGKILL 宽限；校验方式同 `timeoutMs`。 |
| `stdoutMaxBytes` | `4194304` | stdout 的内存上限。溢出时只保留尾部。 |
| `stdoutSpillMaxBytes` | `67108864` | stdout 全文 spill 上限，用于恢复被截断的 JSON 负载。 |
| `stderrMaxBytes` | `65536` | 仅用于日志诊断尾部的 stderr 内存上限。 |
| `env` | `{}` | 叠加在已清洗父环境之上的额外环境变量。不要在此放置凭据；Cursor CLI 把自己的状态放在 `$HOME` 下。 |
| `extraArgs` | `[]` | 额外 CLI 参数。任何重复提供方自有 flag 的元素都会在 spawn 前被拒绝：`--print`、`--output-format`、`--sandbox`、`--force`、`--mode`、`--workspace`、`--trust`、`--model`、`--yolo`、`--endpoint`、`--api-key`、`--header`、`--add-dir`、`--worktree`、`--plugin-dir`、`--approve-mcps`、`--continue`、`--resume`，以及别名 `-p`、`-f`、`-e`、`-H`、`-w`，包括 `-pf` 这样的连写形式。 |



行的 `model` 设置默认路由。`tool-subagent-cursor` 行设置了 `providerOwnedRoute: true`，因此模型可以在每次 `subagent_cursor` 调用中传入 `model`；提供方把它映射为 `--model`，仅当 `provider` 等于本提供方的注册名时接受（Cursor 模型目录没有提供方命名空间），并拒绝请求中的 `reasoning_effort` 或 `maxTokens`，因为 Cursor CLI 没有这些选项。


argv 顺序为 `--print --output-format <fmt> --sandbox <mode> [--trust] --workspace <cwd> [--mode …] [--model …] [--force] [extraArgs…] agent <task>`。显式的 `agent` 命令词填入 CLI 根命令的 `[command]` 槽位，使任务文本只能被解析为 prompt。若任务恰好等于某个 CLI 子命令名（忽略大小写和首尾空白），`start()` 还会额外拒绝它。

### 安全姿态

子进程作为宿主进程运行在 DSH 文件沙箱之外（Cursor CLI 需要 `$HOME`），`--sandbox enabled` 只是纵深防御，不是文件系统边界。提供方把 `--workspace` 固定为父级的子 cwd，从不通过 `env` 传递凭据，默认关闭 `--force`，并拒绝会重述姿态相关 flag 的 `extraArgs`。评审用途建议使用 `mode: ask`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

| 文件 | 作用 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | 插件入口：配置 schema、启动校验、通过 `ctx.effect` 注册提供方。 |
| [`src/args.ts`](src/args.ts) | 纯 argv 构造、保留 flag 检查、任务校验和 prompt 展平。 |
| [`src/parse.ts`](src/parse.ts) | 收集流恢复，以及退出码/输出格式到 `stopReason` 的映射。 |
| [`src/diagnostic.ts`](src/diagnostic.ts) | 凭据掩码和受 UTF-8 字节上限约束的诊断格式化。 |

发布之前的一切——cwd 校验、可执行文件解析、任务与 `extraArgs` 校验，以及 spawn 本身——都会拒绝 `start()` 且不留下存活资源。发布之后的一切通过返回 run 的 `result` 结算。一个融合截止时间把父级取消和 `timeoutMs` 组合起来，并驱动 subprocess 提供方的 SIGTERM → 宽限 → SIGKILL 阶梯。

`agent --print --output-format json` 的 JSON schema 尚未验证。只有可解析且非错误的负载才会完成；解析失败、`is_error` 或非零退出都会变成 `error`，同时保留已收集的输出。stdout 被截断时，会在解析前从 spill 文件恢复完整内容，因为收集只保留尾部。

-----

<a id="further-exploration"></a>
## 进一步探索

- [fork 分组](../README.zh.md) — 本分组的包地图。
- [subagent seam](../../subagent/subagent/README.zh.md) — 本插件实现的提供方/run 词汇。
- [subprocess seam](../../subprocess/subprocess/README.zh.md) — 提供方依赖的收集、spill 和终止行为。

-----

<a id="model-experience"></a>
## 模型体验

### `subagent_cursor` 执行

#### 模型看到什么

上游 `@deepseek-ai/dsh-tool-subagent` 包注册 `subagent_cursor` 工具，由本提供方执行。任务通过 argv 传递，因此 `prompt` 只可包含文本块；成功运行返回一个文本块，内容为 CLI 的结果负载（或原始 stdout），失败则返回已收集输出与经过凭据片段遮蔽的有界诊断。

#### Token 影响

工具 schema 属于上游包，行挂载期间每次请求固定开销。每次调用把参数与有界结果或诊断追加到普通工具历史。

#### KV Cache 影响

行配置不变时 schema 保持稳定，提示前缀维持缓存形态；调用追加在既有历史之后。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **宿主进程，不受 DSH 沙箱约束。** Cursor CLI 在 DSH 文件沙箱之外运行，可能写到工作区之外；实测 `--sandbox enabled` 并不能阻止对 `$HOME` 的写入。
- **非交互式的 fail-open 行为。** Cursor CLI 没有与 `canUseTool` 等价的 fail-closed 钩子。默认值假定它在无法询问时可能放行操作，因此 `force` 默认关闭。
- **JSON 输出 schema 尚未验证。** `is_error` 和 `result` 只能从 CLI 的 print 输出中尽力读取；`outputFormat: text` 是逃生通道。
- **仅支持 argv 大小的任务。** 展平后的任务上限为 65536 UTF-8 字节，且不能以 `-` 开头；未实现 stdin 传递。
- **日志中没有 pid。** `SubprocessHandle` 不暴露 pid，因此审计行只记录 argv、cwd、退出码、signal 和 `stopReason`。
- **没有移植 `cordis.patch.yml`。** 行由 `anago-core` 持有；只安装本包不会注册任何内容。
- **并发运行共享 Cursor 的 `$HOME` 状态。** 同一工作区的并行委派可能在 `~/.cursor` 中竞争；本移植不做串行化。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

本移植保持与源插件相同的行为，只把模块 JSDoc 标签中的包名和相对导入说明符改为新包名。测试从 `*.test.ts` 重命名为 `*.spec.ts`，测试逻辑未改。源 `cordis.patch.yml` 有意未复制，因为行由捆绑包持有。
</details>
