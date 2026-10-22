---
description: "Pi coding agent CLI one-shot subagent provider for the DSH subagent seam."
kind: "package-reference"
---

# @anago-harness/subagent-pi

[English](README.md) | 中文

## 概述

`@anago-harness/subagent-pi` 向 DSH 的 subagent seam 注册一个名为 `pi` 的一次性外部子代理提供方。每次被接受的委派都会在委派 Session 的工作区中启动且仅启动一个 `pi --print --mode json` 子进程，并把 JSONL 事件流中最后一条 assistant 消息映射为 `completed`，除非其 stop reason 报告错误或中止。

模型可见的 `subagent_pi` 工具不属于本包。组合捆绑包通过上游 `@deepseek-ai/dsh-tool-subagent` 行（`provider: pi`、`maxDepth: provider-managed`）添加该工具；本包只负责提供方。

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
- id: subagent-pi
  name: '@anago-harness/subagent-pi'
- id: tool-subagent-pi
  name: '@deepseek-ai/dsh-tool-subagent'
  config:
    provider: pi
    toolName: subagent_pi
    maxDepth: provider-managed
```

本包依赖 `subagents` 和 `subprocess` 服务。Pi CLI（`pi`）必须位于子进程的 `PATH` 中，或由 `executable` 指定；解析失败会拒绝 `start()` 并给出安装提示，绝不会回退到其他二进制。Pi 按用户安装在 `~/.pi` 下，子进程通过已清洗的父环境继承该目录。

### 配置

在 `subagent-pi` 行上设置 `config`。凡是自包含的校验都在插件加载时完成；非法的时间上限、缺少 `model` 的 `provider`、相对的 `sessionDir` 和不可用的工具名都会抛错，而不是被截断或丢弃。

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `providerName` | `pi` | `ctx.subagents` 中的注册名；同一组合内必须唯一。 |
| `executable` | `pi` | 通过 `ctx.subprocess.resolveExecutable` 解析的 Pi CLI 可执行文件。 |
| `provider` | （未设置） | `--provider` 的值。必须同时设置 `model`；CLI 只用 `--provider` 搜索 `--model`。 |
| `model` | （未设置） | `--model` 模式或 ID；未设置时使用 Pi 自己配置的模型。 |
| `thinking` | （未设置） | `--thinking` 级别：`off`、`minimal`、`low`、`medium`、`high`、`xhigh` 或 `max`。 |
| `tools` | （未设置） | `--tools` 允许列表。`[]` 发送 `--no-tools`，禁用全部工具。 |
| `excludeTools` | （未设置） | `--exclude-tools` 拒绝列表。`[]` 不发送任何内容。 |
| `approve` | `true` | 发送 `--approve`，在本次运行中信任项目本地文件；`false` 发送 `--no-approve`。 |
| `sessionDir` | （未设置） | 绝对的 `--session-dir`。未设置时发送 `--no-session`，子进程不写会话。 |
| `env` | `{}` | 叠加在已清洗父环境之上的额外环境变量。不要在此放置凭据；Pi 在 `$HOME` 下保存自己的认证。 |
| `timeoutMs` | （未设置） | 单次运行的挂钟预算。必须为正有限值且不超过 `2147483647`；未设置时只由父级取消提供边界。 |
| `disposeGraceMs` | `3000` | 交给 subprocess 提供方的 SIGTERM 到 SIGKILL 宽限；校验方式同 `timeoutMs`。 |

argv 顺序为 `--print --mode json [--provider <p> --model <m>] [--thinking <level>] [--tools <csv> | --no-tools] [--exclude-tools <csv>] [--approve | --no-approve] [--session-dir <dir> | --no-session] -- <task>`。任务位于 `--` 之后，因此以 `-` 开头的文本仍会作为 prompt 传递。

行的 `provider` 与 `model` 设置本提供方的默认路由，且必须成对设置（Pi 只用 `--provider` 查找 `--model`）。当 Host 启用 `subagent-model-selection` 并列出该精确路由时，调用方可以为单次委派选择其他路由；提供方把请求中的 `agentOptions.provider`、`agentOptions.model`、`agentOptions.reasoningEffort` 映射为 `--provider`、`--model`、`--thinking`。请求中的 `agentOptions.maxTokens` 会被拒绝，因为 Pi CLI 没有该选项；不在 Pi 级别内的推理强度也会被拒绝，而不是被忽略。

### 安全姿态

子进程作为宿主进程运行在 DSH 文件沙箱之外；Pi 需要 `$HOME` 保存自身状态。`approve` 默认为 `true`，会传递 Pi 的 `--approve`，在本次运行中信任项目本地文件（扩展、skill 和提示模板）；在不可信工作区中应设为 `false`。提供方从不通过 `env` 传递凭据；未用 `provider`、`model`、`thinking` 覆盖时，Pi 自己的提供方、模型和认证设置生效。

-----

<a id="understand-the-implementation"></a>
## 理解实现

| 文件 | 作用 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | 插件入口：配置 schema、启动校验、通过 `ctx.effect` 注册提供方。 |
| [`src/run.ts`](src/run.ts) | 单次运行生命周期：cwd 与可执行文件校验、spawn 规格、取消、结算与清理。 |
| [`src/args.ts`](src/args.ts) | prompt 展平、工具列表校验和固定的 argv 顺序。 |
| [`src/parse.ts`](src/parse.ts) | 增量 JSONL 解码与事件流到 `stopReason` 的映射。 |
| [`src/diagnostic.ts`](src/diagnostic.ts) | 凭据掩码和受 UTF-8 字节上限约束的诊断格式化。 |

发布之前的一切——cwd 校验、prompt 展平、可执行文件解析，以及 spawn 本身——都会拒绝 `start()` 且不留下存活资源。发布之后的一切通过返回 run 的 `result` 结算。一个融合截止时间把父级取消和 `timeoutMs` 组合起来，并驱动 subprocess 提供方的 SIGTERM → 宽限 → SIGKILL 阶梯。

`--mode json` 每行输出一个 JSON 对象。解析器只保留最后一条 `message.role` 为 `assistant` 的 `message_end`、`agent_settled.aborted` 报告的中止状态，以及不可解析行的计数，从不保留原始事件流。`stop` 或缺失的 stop reason 视为完成，`length`（Pi 的 token 上限）或 `max-tokens` 映射为 `max-tokens`，`error` 映射为错误并附带经过掩码的 `errorMessage` 有界诊断，`aborted` 映射为 `aborted`。没有可用 assistant 消息的非零退出、不可解析的行、无法识别的 stop reason 都会失败关闭。取消会以 `aborted` 结算并保留已收集的 assistant 文本，清理阶段终止受管进程范围并等待真正静止。

-----

<a id="further-exploration"></a>
## 进一步探索

- [fork 分组](../README.zh.md) — 本分组的包地图。
- [subagent seam](../../subagent/subagent/README.zh.md) — 本插件实现的提供方/run 词汇。
- [subprocess seam](../../subprocess/subprocess/README.zh.md) — 提供方依赖的终止、收集和取消行为。
- [Pi CLI](https://pi.dev) — 本提供方所消费的 print 模式协议的上游编码代理。

-----

<a id="model-experience"></a>
## 模型体验

### `subagent_pi` 执行

#### 模型看到什么

上游 `@deepseek-ai/dsh-tool-subagent` 包注册 `subagent_pi` 工具，由本提供方执行。任务通过 argv 传递，因此 `prompt` 只可包含文本块；成功运行把最后一条非空 assistant 消息中的每个文本块返回为一个文本块，失败则返回已收集输出与经过凭据片段遮蔽的有界诊断。

#### Token 影响

工具 schema 属于上游包，行挂载期间每次请求固定开销。每次调用把参数与有界结果或诊断追加到普通工具历史。

#### KV Cache 影响

行配置不变时 schema 保持稳定，提示前缀维持缓存形态；调用追加在既有历史之后。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **宿主进程，不受 DSH 沙箱约束。** Pi CLI 在 DSH 文件沙箱之外运行，可能写到工作区之外；`--approve` 不构成文件系统边界。
- **未配置时沿用 Pi 自身设置。** 当 `provider`、`model`、`thinking` 未设置时，提供方、模型、思考级别、扩展、skill 和认证都来自 `~/.pi` 下的每用户状态。
- **仅支持一次性运行。** 提供方没有 `prepareContinuable`，不接受后续消息，也无法恢复它启动的子会话。
- **仅支持 argv 大小的任务。** 展平后的任务上限为 65536 UTF-8 字节，只可包含文本块，并通过 argv 而非 stdin 传递；图片和文件必须内联为文本。
- **`approve` 会信任项目本地文件。** 默认 `true` 会传递 `--approve`，因此仓库可以向子进程贡献扩展、skill 和提示模板。不可信工作区应使用 `approve: false`。
- **日志中没有 pid。** `SubprocessHandle` 不暴露 pid，因此审计行只记录 argv、cwd、退出码、signal 和 `stopReason`。
- **没有移植 `cordis.patch.yml`。** 行由组合捆绑包持有；只安装本包不会注册任何内容。
- **并发运行可能共享 Pi 状态。** 使用同一 `sessionDir` 的并行委派共享 Pi 的会话存储；本提供方不做串行化。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

本提供方有意作为 `@anago-harness/subagent-cursor` 的姊妹包，但不与其共享 CLI 管道：Pi 流式输出 JSONL 并由消息 stop reason 决定成败，而 Cursor CLI 输出单个 JSON 负载并由退出码决定成败。共享的 seam 行为——能力声明、cwd 校验、时间校验、结算和 run 句柄发布——来自 `@deepseek-ai/dsh-subagent/out-of-process`，而不是本地副本。测试通过 `tests/fixtures/pi-fixture.mjs` 驱动协议，该 Node 脚本由 `PI_FIXTURE_MODE` 选择，绝不接触模型。
</details>
