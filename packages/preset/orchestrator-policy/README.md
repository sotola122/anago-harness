---
description: "Mount this row in the orchestrator preset so the parent session delegates work and cannot directly start claude, cursor, cursor-agent, or codex."
kind: "package-reference"
---

# @deepseek-ai/dsh-orchestrator-policy

English | [中文](README.zh.md)

## Summary

Mount this row in the orchestrator preset when the parent session should split work and delegate it. At depth 0 the model reads a delegation contract before the tool descriptions, and a direct bash or pwsh start of claude, cursor, cursor-agent, or codex is refused. Inspection, tests, git queries, and landing a child's result stay available. A deeper agent in the same preset sees the ordinary coding persona and can run those CLIs. A script or interpreter can still start them, because this row does not read files.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this row inside a preset composition. It rejects a mount that has no agent scope, because a global guard would deny the same commands for every agent.

### When to choose it

Choose it for the Web `orchestrator` preset, whose parent should delegate implementation and external agent CLIs. Do not mount it on `standard`: that preset's agents are the workers that run those CLIs. A static persona row cannot replace it, because fork and workflow children join this preset generation and must see the ordinary coding persona.

### Minimal configuration

```yaml
- id: orchestrator-policy
  name: '@deepseek-ai/dsh-orchestrator-policy'
```

| Field | Default | Meaning |
|---|---|---|
| `binaries` | `claude`, `cursor`, `cursor-agent`, `codex` | Basenames denied at depth 0. A path fails at load |
| `promptSkills` | `writing-for-agents` | Skills loaded with the skill tool before a child prompt is composed. Empty omits that sentence |
| `childSkills` | `ponytail` | Skills an implementation child loads before it changes code. Empty omits that sentence |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-orchestrator-policy) is the exhaustive source for every accepted field.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The row registers a depth-dependent persona and an `orchestrator:policy` section on the preset scope. Both read `AssembleContext.agent` and `delegationDepthOf`, which treats a resumed child's session header as authoritative. Empty section text is dropped at render. The guard runs after `tools/pre-execute` and can only deny. It matches a direct `bash` or `pwsh` `command` by basename, including wrappers, one level of `-c` or `-Command`, package runners, and `$(...)` or backticks. It does not read a script file.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: persona, section, guard |
| [`src/command.ts`](src/command.ts) | Direct-invocation match |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Agent presets](../agent-preset-registry/README.md) — the preset composition this row mounts into.
- [System prompt](../../../docs/subsystems/system-prompt.md) — section order and empty-section rendering.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-orchestrator-policy) — every accepted config field.

-----

<a id="model-experience"></a>
## Model Experience

### Depth-0 persona system prompt

#### What the model sees

At delegation depth 0 the `deployment:persona-prefix` section is the orchestrator sentence below. At depth 1 or above, and when assembly has no agent, it is the ordinary coding sentence `You are a coding agent powered by the {{model}} model.`

##### Orchestrator persona

```markdown
You are the orchestrator for this session. Split work and delegate it; keep your tools for inspection and for landing a child's result.
```

#### Token effect

Fixed for a depth-0 agent: one sentence on every request. A deeper agent in this preset pays the ordinary coding sentence instead, not both.

#### KV Cache effect

Prefix-stable while the depth and the sentence stay the same. A depth change replaces the persona prefix and can invalidate reuse from the start of the prompt.

### Delegation contract system prompt

#### What the model sees

At depth 0, section `orchestrator:policy` (order 550, before tool guidance) is the contract below. `promptSkills` and `childSkills` fill the two skill sentences; an empty list omits that sentence. At depth 1 or above the text is empty and render omits the section.

##### Delegation contract

```markdown
Split a request into tasks and delegate each task with the subagent tool. When that tool lists category, set it; otherwise omit it. Before composing a child prompt, load writing-for-agents with the skill tool and follow it. In every implementation child prompt, tell the child to load ponytail with the skill tool before it changes code.

Before a follow-up delegation, call list_agents and continue a matching child with send_message when the new task has the same purpose and files, its recorded provider, model, and reasoning effort still match the purpose route, and the earlier work was short or mechanical. Set description to the purpose; list_agents keeps that label after compaction removes the tool result. Otherwise start a new child: long or exploratory work whose transcript would cost more than a fresh child's first request, the task must not see earlier context, category review (one call fans out one child per route), tasks that must run in parallel, started together, or no child matching the route. One child is one conversation and cannot run two tasks at once. It keeps the route, working directory, and history it started with. A follow-up reply arrives as a completion notice, not a synchronous answer. One todo item is one delegation, and a follow-up on that todo continues the child that delegation started.

Inspect with read, glob, grep, and the shell. Run tests and git queries yourself. Edit a file yourself only to land a result a child already returned.

Start claude, cursor, cursor-agent, and codex only inside a delegated child. Call the subagent tool, put the exact command in the child prompt, and tell the child to return the output. Wait for the completion notice. A shell error that tells you to delegate means call subagent; do not hide the same command in a script or an interpreter.

create_goal continues this same session, so it does not replace a delegation.
```

#### Token effect

About 316 words on every depth-0 request with the default skill lists, and none for a deeper agent in this preset. Changing `binaries` does not change this text. An empty `promptSkills` or `childSkills` drops that sentence, and any other list changes it.

#### KV Cache effect

Prefix-stable across steps while the contract text is unchanged. It sits before tool guidance, so an edit invalidates reuse from this section onward. Depth 1 and above omit it, so those requests do not share the depth-0 prefix.

### Denied shell result

#### What the model sees

A denied `bash` or `pwsh` call returns `Error: ` plus the fixed sentence below. The tool body does not run. Other tools, and the same command at depth 1 or above, are unchanged.

##### Denial sentence

```markdown
Do not start an external agent CLI in this session. Delegate with the subagent tool and tell the child the exact command. The child runs it and returns the output. Do not hide that command in a script or an interpreter.
```

#### Token effect

Zero until a denial. One denial adds that sentence once as a tool result.

#### KV Cache effect

A denial appends after the reusable request prefix. It does not change the system prompt. A later request that does not repeat the denied call keeps the previous prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits are current package constraints. They are not a task list.

- **Indirect invocation cannot be blocked** — `bash ./run.sh`, `python -c`, `node -e`, and a command name built by variable expansion still run. The guard is synchronous and does not read files. The denial text tells the model not to hide the command; it cannot enforce that.
- **Wrapper flag arguments are not peeled** — `timeout 30 cursor` is denied, but `nice -n 19 claude` is not, because the match skips flags and `NAME=value` only. `timeout` also skips one duration token.
- **No global mount** — an unscoped mount fails at load. A deployment-wide denial does not belong here.
- **Prompt text does not follow `binaries`** — adding a basename changes the guard only. The contract still names the initial four.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
