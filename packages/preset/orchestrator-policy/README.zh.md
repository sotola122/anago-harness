---
description: "把本行挂进 orchestrator preset，让父会话委派工作，并且不能直接启动 claude、cursor、cursor-agent 或 codex。"
kind: "package-reference"
---

# @deepseek-ai/dsh-orchestrator-policy

[English](README.md) | 中文

## 概述

当父会话应当拆分工作并委派时，把本行挂进 orchestrator preset。深度 0 时，模型会在工具说明之前读到委派约定，并且 bash 或 pwsh 直接启动 claude、cursor、cursor-agent 或 codex 会被拒绝。检查、测试、git 查询，以及把子会话的结果写入文件，仍然可以做。同一 preset 里更深的 agent 看到的是普通编程人设，可以运行这些 CLI。脚本或解释器仍然能启动它们，因为本行不读文件。

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

把本行挂进 preset 组合。没有 agent scope 的挂载会被拒绝，因为全局 guard 会为每个 agent 拒绝同样的命令。

### 何时使用

把它用于 Web 的 `orchestrator` preset：父会话应当委派实现和外部 agent CLI。不要挂到 `standard` 上：那个 preset 的 agent 才是运行这些 CLI 的工作者。静态 persona 行不能代替它，因为 fork 和 workflow 的子会话会加入这一 preset 代际，必须看到普通编程人设。

### 最小配置

```yaml
- id: orchestrator-policy
  name: '@deepseek-ai/dsh-orchestrator-policy'
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `binaries` | `claude`、`cursor`、`cursor-agent`、`codex` | 深度 0 拒绝的 basename。路径在加载时失败 |
| `promptSkills` | `writing-for-agents` | 编写子提示词之前用 skill（技能）工具加载的 skill。空数组省略该句 |
| `childSkills` | `ponytail` | 实现子会话在改代码之前要加载的 skill。空数组省略该句 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-orchestrator-policy)是每个被接受字段的完整来源。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本行在 preset scope 上注册随深度变化的 persona 和 `orchestrator:policy` 节。两者都读取 `AssembleContext.agent` 和 `delegationDepthOf`；后者把已恢复子会话的 session header 当作权威深度。空节文本在渲染时被丢掉。guard 在 `tools/pre-execute` 之后运行，只能拒绝。它按 basename 匹配直接的 `bash` 或 `pwsh` `command`，包括包装命令、一层 `-c` 或 `-Command`、包运行器，以及 `$(...)` 或反引号。它不读取脚本文件。

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：persona、节、guard |
| [`src/command.ts`](src/command.ts) | 直接启动匹配 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Agent preset](../agent-preset-registry/README.zh.md) — 本行挂入的 preset 组合。
- [系统提示词](../../../docs/subsystems/system-prompt.zh.md) — 节的顺序，以及空节如何在渲染时消失。
- [生成的配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-orchestrator-policy) — 每个被接受的配置字段。

-----

<a id="model-experience"></a>
## 模型体验

### 深度 0 的人设系统提示词

#### 模型看到什么

委派深度为 0 时，`deployment:persona-prefix` 节是下面的编排句。深度为 1 或以上，以及组装时没有 agent 时，它是普通编程句 `You are a coding agent powered by the {{model}} model.`。

##### 编排人设

```markdown
You are the orchestrator for this session. Split work and delegate it; keep your tools for inspection and for landing a child's result.
```

#### Token 影响

对深度 0 的 agent 是固定的：每次请求一句。本 preset 里更深的 agent 只付普通编程句的代价，而不是两句一起付。

#### KV Cache 影响

深度和句子不变时，前缀保持稳定。深度变化会替换人设前缀，并可能使从提示词开头起的复用失效。

### 委派约定系统提示词

#### 模型看到什么

深度 0 时，`orchestrator:policy` 节（order 550，在工具说明之前）是下面的约定。`promptSkills` 和 `childSkills` 填入两句 skill 指令；空数组省略该句。深度为 1 或以上时文本为空，渲染会省略该节。

##### 委派约定

```markdown
Split a request into tasks and delegate each task with the subagent tool. When that tool lists category, set it; otherwise omit it. Before composing a child prompt, load writing-for-agents with the skill tool and follow it. In every implementation child prompt, tell the child to load ponytail with the skill tool before it changes code.

Before a follow-up delegation, call list_agents and continue a matching child with send_message when the new task has the same purpose and files, its recorded provider, model, and reasoning effort still match the purpose route, and the earlier work was short or mechanical. Set description to the purpose; list_agents keeps that label after compaction removes the tool result. Otherwise start a new child: long or exploratory work whose transcript would cost more than a fresh child's first request, the task must not see earlier context, category review (one call fans out one child per route), tasks that must run in parallel, started together, or no child matching the route. One child is one conversation and cannot run two tasks at once. It keeps the route, working directory, and history it started with. A follow-up reply arrives as a completion notice, not a synchronous answer. One todo item is one delegation, and a follow-up on that todo continues the child that delegation started.

Inspect with read, glob, grep, and the shell. Run tests and git queries yourself. Edit a file yourself only to land a result a child already returned.

Start claude, cursor, cursor-agent, and codex only inside a delegated child. Call the subagent tool, put the exact command in the child prompt, and tell the child to return the output. Wait for the completion notice. A shell error that tells you to delegate means call subagent; do not hide the same command in a script or an interpreter.

create_goal continues this same session, so it does not replace a delegation.
```

#### Token 影响

深度 0 的每次请求在默认 skill 列表下大约 316 个词，本 preset 里更深的 agent 则为零。改变 `binaries` 不会改变这段文字。`promptSkills` 或 `childSkills` 为空则去掉对应的句子，其他列表会改那一句。

#### KV Cache 影响

约定文本不变时，各步骤之间的前缀保持稳定。它位于工具说明之前，因此编辑会使从本节起的复用失效。深度 1 及以上会省略它，所以那些请求不共享深度 0 的前缀。

### 被拒绝的 shell 结果

#### 模型看到什么

被拒绝的 `bash` 或 `pwsh` 调用返回 `Error: ` 加上下面的固定句。工具本体不运行。其他工具，以及深度 1 及以上的同一命令，保持不变。

##### 拒绝句

```markdown
Do not start an external agent CLI in this session. Delegate with the subagent tool and tell the child the exact command. The child runs it and returns the output. Do not hide that command in a script or an interpreter.
```

#### Token 影响

拒绝发生之前为零。一次拒绝把该句作为工具结果加入一次。

#### KV Cache 影响

拒绝追加在可复用的请求前缀之后。它不改变系统提示词。之后不再重复该拒绝调用的请求保留先前的前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制是当前的包约束，不是任务列表。

- **间接启动无法阻止** — `bash ./run.sh`、`python -c`、`node -e`，以及用变量展开拼出的命令名，仍然会运行。guard 是同步的，并且不读文件。拒绝文本告诉模型不要把命令藏起来；它无法强制这一点。
- **包装命令的标志参数不会被剥开** — `timeout 30 cursor` 会被拒绝，但 `nice -n 19 claude` 不会，因为匹配只跳过标志和 `NAME=value`。`timeout` 还会再跳过一个时长记号。
- **不能全局挂载** — 没有 scope 的挂载在加载时失败。部署级的拒绝不属于这里。
- **提示词文本不跟随 `binaries`** — 增加 basename 只改变 guard。约定仍然点名最初的四个名字。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
