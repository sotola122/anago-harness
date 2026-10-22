---
description: "Pi coding agent CLI one-shot subagent provider for the DSH subagent seam."
kind: "package-reference"
---

# @anago-harness/subagent-pi

English | [中文](README.zh.md)

## Summary

`@anago-harness/subagent-pi` registers a one-shot external subagent provider named `pi` with the DSH subagent seam. One accepted delegation starts exactly one `pi --print --mode json` child in the delegating Session's workspace and maps the last assistant message of the JSONL event stream to `completed` unless its stop reason reports an error or abort.

The model-facing `subagent_pi` tool is not part of this package. The composing bundle adds it through the upstream `@deepseek-ai/dsh-tool-subagent` row with `provider: pi` and `maxDepth: provider-managed`; this package only owns the provider.

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
- id: subagent-pi
  name: '@anago-harness/subagent-pi'
- id: tool-subagent-pi
  name: '@deepseek-ai/dsh-tool-subagent'
  config:
    provider: pi
    toolName: subagent_pi
    maxDepth: provider-managed
```

The package requires the `subagents` and `subprocess` services. The Pi CLI (`pi`) must be on the child process's `PATH` or named by `executable`; a failed resolution rejects `start()` with an install hint and never falls back to another binary. Pi installs per user under `~/.pi`, so the child inherits that directory through the scrubbed parent environment.

### Configuration

Set `config` on the `subagent-pi` row. Every field is validated at plugin load where it is self-contained; invalid timing bounds, `provider` without `model`, a relative `sessionDir`, and unusable tool names throw instead of being clamped or dropped.

| Field | Default | Meaning |
| --- | --- | --- |
| `providerName` | `pi` | Registry name in `ctx.subagents`; must be unique per composition. |
| `executable` | `pi` | Pi CLI executable resolved through `ctx.subprocess.resolveExecutable`. |
| `provider` | (unset) | `--provider` value. Requires `model`; the CLI uses `--provider` only to search for `--model`. |
| `model` | (unset) | `--model` pattern or id; unset uses Pi's own configured model. |
| `thinking` | (unset) | `--thinking` level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`. |
| `tools` | (unset) | `--tools` allowlist. `[]` emits `--no-tools`, disabling every tool. |
| `excludeTools` | (unset) | `--exclude-tools` denylist. `[]` emits nothing. |
| `approve` | `true` | Emits `--approve`, trusting project-local files for the run; `false` emits `--no-approve`. |
| `sessionDir` | (unset) | Absolute `--session-dir`. Unset emits `--no-session`, so the child writes no session. |
| `env` | `{}` | Extra environment variables layered over the scrubbed parent environment. Do not put credentials here; Pi keeps its own auth under `$HOME`. |
| `timeoutMs` | (unset) | Wall-clock budget for one run. Positive, finite, at most `2147483647`; unset leaves parent cancellation as the only bound. |
| `disposeGraceMs` | `3000` | SIGTERM-to-SIGKILL grace handed to the subprocess provider; validated like `timeoutMs`. |

The argv order is `--print --mode json [--provider <p> --model <m>] [--thinking <level>] [--tools <csv> | --no-tools] [--exclude-tools <csv>] [--approve | --no-approve] [--session-dir <dir> | --no-session] -- <task>`. The task follows `--`, so text that begins with `-` is still delivered as the prompt.

The row's `provider` and `model` set this provider's default route, and both must be set together (Pi uses `--provider` only to look up `--model`). A caller can select another route per delegation when the Host enables `subagent-model-selection` and lists that exact route; the provider maps the request's `agentOptions.provider`, `agentOptions.model`, and `agentOptions.reasoningEffort` onto `--provider`, `--model`, and `--thinking`. A requested `agentOptions.maxTokens` is rejected, because the Pi CLI has no such flag, and a reasoning effort outside Pi's levels is rejected instead of ignored.

### Security posture

The child runs as a host process outside the DSH file sandbox; Pi needs `$HOME` for its own state. `approve` defaults to `true`, which passes Pi's `--approve` and trusts project-local files (extensions, skills, and prompt templates) for the run; set it to `false` in untrusted workspaces. The provider never places credentials in `env`, and Pi's own provider, model, and auth settings apply unless `provider`, `model`, or `thinking` override them.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

| File | Role |
| --- | --- |
| [`src/index.ts`](src/index.ts) | Plugin entry: config schema, startup validation, provider registration through `ctx.effect`. |
| [`src/run.ts`](src/run.ts) | Per-run lifecycle: cwd and executable validation, spawn spec, cancellation, settlement, and teardown. |
| [`src/args.ts`](src/args.ts) | Prompt flattening, tool-list validation, and the fixed argv order. |
| [`src/parse.ts`](src/parse.ts) | Incremental JSONL decoding and the stream-to-`stopReason` mapping. |
| [`src/diagnostic.ts`](src/diagnostic.ts) | Credential masking and UTF-8 byte-bounded diagnostic formatting. |

Everything before publication — cwd validation, prompt flattening, executable resolution, and the spawn itself — rejects `start()` and leaves no live resource. Everything after publication settles through the returned run's `result`. One fused deadline composes the parent's cancellation with `timeoutMs` and drives the subprocess provider's SIGTERM → grace → SIGKILL ladder.

`--mode json` writes one JSON object per line. The parser keeps the last `message_end` whose `message.role` is `assistant`, whether `agent_settled.aborted` reported an abort, and a count of unparseable lines; it never retains the raw stream. A `stop` or absent stop reason completes, `length` (Pi's token ceiling) or `max-tokens` maps to `max-tokens`, `error` maps to an error whose bounded diagnostic carries the masked `errorMessage`, and `aborted` maps to `aborted`. A non-zero exit without a usable assistant message, an unparseable line, or an unrecognized stop reason fails closed. Cancellation settles `aborted` with the assistant text collected so far, and teardown terminates the managed range and awaits real quiescence.

-----

<a id="further-exploration"></a>
## Further Exploration

- [fork group](../README.md) — the package map for this group.
- [subagent seam](../../subagent/subagent/README.md) — the provider/run vocabulary this plugin implements.
- [subprocess seam](../../subprocess/subprocess/README.md) — termination, collection, and cancellation behavior the provider relies on.
- [Pi CLI](https://pi.dev) — the upstream coding agent whose print-mode protocol this provider consumes.

-----

<a id="model-experience"></a>
## Model Experience

### `subagent_pi` execution

#### What the model sees

The upstream `@deepseek-ai/dsh-tool-subagent` package registers the `subagent_pi` tool and this provider executes it. A task travels as argv, so `prompt` may contain text blocks only; a completed run returns one text block per assistant text block from the last non-empty assistant message, and a failure returns the collected output plus a bounded diagnostic with credential-shaped fragments masked.

#### Token effect

The tool schema belongs to the upstream package and costs a fixed amount per request while the row is mounted. Each call appends its arguments and bounded result or diagnostic to ordinary tool history.

#### KV Cache effect

The schema stays stable while the row configuration is unchanged, so the prompt prefix keeps its cached form; calls append after prior history.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Host process, not sandboxed by DSH.** The Pi CLI runs outside the DSH file sandbox and may write outside the workspace; `--approve` does not add a filesystem boundary.
- **Pi's own settings apply unless configured.** Provider, model, thinking level, extensions, skills, and auth come from Pi's per-user state under `~/.pi` when `provider`, `model`, and `thinking` are unset.
- **One-shot only.** The provider has no `prepareContinuable`, accepts no follow-up messages, and cannot resume the child session it started.
- **Argv-sized prompts only.** The flattened task is limited to 65536 UTF-8 bytes, must contain only text blocks, and is delivered through argv rather than stdin; images and files must be inlined as text.
- **`approve` trusts project-local files.** The default `true` passes `--approve`, so a repository can contribute extensions, skills, and prompt templates to the child. Use `approve: false` in untrusted workspaces.
- **No pid in logs.** `SubprocessHandle` exposes no pid, so the audit line records argv, cwd, exit code, signal, and `stopReason` only.
- **No ported `cordis.patch.yml`.** Rows live in the composing bundle; installing this package alone registers nothing.
- **Concurrent runs can share Pi state.** Parallel delegations with the same `sessionDir` share Pi's session storage; this provider does not serialize them.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The provider is intentionally a sibling of `@anago-harness/subagent-cursor` but shares no CLI plumbing with it: Pi streams JSONL and decides success from the message stop reason, whereas the Cursor CLI emits one JSON payload and decides success from its exit code. Shared seam behavior — capability advertisement, cwd validation, timing checks, settlement, and run-handle publication — comes from `@deepseek-ai/dsh-subagent/out-of-process` rather than a local copy. Tests drive the protocol through `tests/fixtures/pi-fixture.mjs`, a Node script selected with `PI_FIXTURE_MODE` that never contacts a model.
</details>
