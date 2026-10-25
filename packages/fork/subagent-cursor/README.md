---
description: "Cursor Agent CLI one-shot subagent provider for the DSH subagent seam."
kind: "package-reference"
---

# @anago-harness/subagent-cursor

English | [中文](README.zh.md)

## Summary

`@anago-harness/subagent-cursor` registers a one-shot external subagent provider named `cursor` with the DSH subagent seam. One accepted delegation starts exactly one `agent --print` child in the delegating Session's workspace and maps a parseable, non-error JSON payload (or a clean `--output-format text` run) to `completed`.

The model-facing `subagent_cursor` tool is not part of this package. The `anago-core` bundle adds it through the upstream `@deepseek-ai/dsh-tool-subagent` row with `provider: cursor` and `maxDepth: provider-managed`; this package only owns the provider.

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

The bundle owns the rows, so this package has no `cordis.patch.yml`. Add the two rows in the composing bundle:

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

The package requires the `subagents` and `subprocess` services. The Cursor CLI (`agent`) must be on the child process's `PATH` or named by `agentBinary`; a failed resolution rejects `start()` and never falls back to another binary.

### Configuration

Set `config` on the `subagent-cursor` row. Every field is validated at plugin load where it is self-contained; invalid timing or byte bounds throw instead of being clamped.

| Field | Default | Meaning |
| --- | --- | --- |
| `providerName` | `cursor` | Registry name in `ctx.subagents`; must be unique per composition. |
| `agentBinary` | `agent` | Cursor CLI executable resolved through `ctx.subprocess.resolveExecutable`. |
| `model` | (unset) | `--model` value; unset uses the CLI default. |
| `outputFormat` | `json` | `--output-format` value. `text` treats a zero-exit raw stdout as success and bypasses JSON parsing. |
| `mode` | `agent` | `agent` emits no `--mode`. `ask` and `plan` are the CLI's read-only modes. |
| `sandbox` | `true` | Emits `--sandbox enabled`; `false` (diagnostics only) emits `--sandbox disabled`. |
| `force` | `false` | Emits `--force` (Run Everything); off by default. |
| `trust` | `true` | Emits `--trust`, skipping the print-mode workspace trust prompt. |
| `timeoutMs` | (none) | Wall-clock budget for one run; omit it to leave only the parent's cancellation as the bound. A configured value must be positive, finite, and at most `2147483647`; invalid values throw. |
| `disposeGraceMs` | `3000` | SIGTERM-to-SIGKILL grace handed to the subprocess provider; validated like `timeoutMs`. |
| `stdoutMaxBytes` | `4194304` | In-memory stdout cap. On overflow only the tail is retained. |
| `stdoutSpillMaxBytes` | `67108864` | Full-stdout spill cap used to recover a truncated JSON payload. |
| `stderrMaxBytes` | `65536` | In-memory stderr cap used only for the log-line diagnostic tail. |
| `env` | `{}` | Extra environment variables layered over the scrubbed parent environment. Do not put credentials here; the Cursor CLI keeps its own state under `$HOME`. |
| `extraArgs` | `[]` | Extra CLI arguments. Any element that restates a provider-owned flag is rejected before spawn: `--print`, `--output-format`, `--sandbox`, `--force`, `--mode`, `--workspace`, `--trust`, `--model`, `--yolo`, `--endpoint`, `--api-key`, `--header`, `--add-dir`, `--worktree`, `--plugin-dir`, `--approve-mcps`, `--continue`, `--resume`, and aliases `-p`, `-f`, `-e`, `-H`, `-w`, including clustered forms such as `-pf`. |



The row's `model` sets the default route. The `tool-subagent-cursor` row sets `providerOwnedRoute: true`, so the model can pass `model` on each `subagent_cursor` call; the provider maps it onto `--model`, accepts `provider` only when it equals this provider's registry name (a Cursor catalog model has no provider namespace), and rejects a requested `reasoning_effort` or `maxTokens` because the Cursor CLI has no such flags.

The argv order is `--print --output-format <fmt> --sandbox <mode> [--trust] --workspace <cwd> [--mode …] [--model …] [--force] [extraArgs…] agent <task>`. The explicit `agent` command word fills the CLI root's `[command]` slot so the task can only ever be parsed as the prompt. A task that is exactly a CLI subcommand name (case-insensitive, surrounding whitespace ignored) is additionally rejected at `start()`.

### Security posture

The child runs as a host process outside the DSH file sandbox (the Cursor CLI needs `$HOME`), and `--sandbox enabled` is defence in depth rather than a filesystem boundary. The provider fixes `--workspace` to the parent's child cwd, never passes credentials through `env`, keeps `--force` off by default, and rejects `extraArgs` that would restate a posture-changing flag. Use `mode: ask` for review work.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

| File | Role |
| --- | --- |
| [`src/index.ts`](src/index.ts) | Plugin entry: config schema, startup validation, provider registration through `ctx.effect`. |
| [`src/args.ts`](src/args.ts) | Pure argv construction, reserved-flag checks, task validation, and prompt flattening. |
| [`src/parse.ts`](src/parse.ts) | Collected-stream recovery and the exit-code/output-format to `stopReason` mapping. |
| [`src/diagnostic.ts`](src/diagnostic.ts) | Credential masking and UTF-8 byte-bounded diagnostic formatting. |

Everything before publication — cwd validation, executable resolution, task and `extraArgs` validation, and the spawn itself — rejects `start()` and leaves no live resource. Everything after publication settles through the returned run's `result`. One fused deadline composes the parent's cancellation with `timeoutMs` when the deployment configures one and drives the subprocess provider's SIGTERM → grace → SIGKILL ladder; without it only the parent's cancellation bounds the run.

The JSON schema of `agent --print --output-format json` is unverified. Only a parseable, non-error payload completes; a parse failure, `is_error`, or a non-zero exit becomes `error` while retaining the collected output. A truncated stdout is recovered from the spill file before parsing, because collection keeps only the tail.

-----

<a id="further-exploration"></a>
## Further Exploration

- [fork group](../README.md) — the package map for this group.
- [subagent seam](../../subagent/subagent/README.md) — the provider/run vocabulary this plugin implements.
- [subprocess seam](../../subprocess/subprocess/README.md) — collection, spill, and termination behavior the provider relies on.

-----

<a id="model-experience"></a>
## Model Experience

### `subagent_cursor` execution

#### What the model sees

The upstream `@deepseek-ai/dsh-tool-subagent` package registers the `subagent_cursor` tool and this provider executes it. A task travels as argv, so `prompt` may contain text blocks only; a completed run returns one text block with the CLI result payload (or its raw stdout), and a failure returns the collected output plus a bounded diagnostic with credential-shaped fragments masked.

#### Token effect

The tool schema belongs to the upstream package and costs a fixed amount per request while the row is mounted. Each call appends its arguments and bounded result or diagnostic to ordinary tool history.

#### KV Cache effect

The schema stays stable while the row configuration is unchanged, so the prompt prefix keeps its cached form; calls append after prior history.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Host process, not sandboxed by DSH.** The Cursor CLI runs outside the DSH file sandbox and may write outside the workspace; `--sandbox enabled` was not observed to prevent writes under `$HOME`.
- **Non-interactive fail-open behavior.** The Cursor CLI has no `canUseTool`-equivalent fail-closed hook. The defaults assume it may allow an action when it cannot ask, which is why `force` is off and `mode` defaults to `agent`.
- **The JSON output schema is unverified.** `is_error` and `result` are read best-effort from the CLI's print output; `outputFormat: text` is the escape hatch.
- **Argv-sized tasks only.** A flattened task is limited to 65536 UTF-8 bytes and must not begin with `-`; stdin delivery is not implemented.
- **No pid in logs.** `SubprocessHandle` exposes no pid, so the audit line records argv, cwd, exit code, signal, and `stopReason` only.
- **No ported `cordis.patch.yml`.** Rows live in `anago-core`; installing this package alone registers nothing.
- **Concurrent runs share Cursor's `$HOME` state.** Parallel delegations with the same workspace may contend in `~/.cursor`; this port does not serialize them.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The port keeps behavior identical to the source plugin and changes only the package name in module JSDoc tags and relative import specifiers. Tests were renamed from `*.test.ts` to `*.spec.ts`; no test logic changed. The source `cordis.patch.yml` was intentionally not copied because the bundle owns the rows.
</details>
