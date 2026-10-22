---
description: "Terminal UI application plugin for the anago harness, built on the pi terminal UI library."
kind: "package-reference"
---

# @anago-harness/tui

English | [中文](README.zh.md)

## Summary

The first working slice of the anago terminal application. It opens one DSH Agent, renders its durable Session transcript in a pi terminal UI, streams assistant text, puts an editor below the transcript, and answers the approval and user-question waterfalls with modals. The `anago-tui` bundle owns the profile rows; this package owns their behavior.

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

The terminal profile mounts the two rows plus the ask-user tool:

| Row | Package |
|---|---|
| `tui-startup` | `@anago-harness/tui/startup` |
| `tui-app` | `@anago-harness/tui` |
| `tool-ask-user` | `@deepseek-ai/dsh-tool-ask-user` |

Start it from the checkout:

```sh
pnpm dsh --profile tui
pnpm dsh --profile tui --resume <sessionId>
pnpm dsh --profile tui --inline --theme light
```

Flags:

| Flag | Meaning |
|---|---|
| `--resume <sessionId>` | Resume a persisted Session instead of creating one. |
| `--model <id>` | Override the configured default model id for this run. |
| `--provider <route>` | Override the configured default provider route for this run. |
| `--theme <dark\|light>` | Palette override for this run. |
| `--inline` | Render into the main screen and keep terminal scrollback; the default uses the alternate screen. |

The Agent starts from the configured `agentDefaultModel` provider and model; each flag replaces only the half it names. With no configured default and no complete flag pair, the app writes one stderr line naming `--provider`, `--model`, and `agentDefaultModel`, then exits with status 1 before dispatching a request. The row config `theme` and `inline` are the defaults the flags override. It refuses to start when stdout is not a TTY: it writes one line naming the interactive requirement and `dsh --profile headless`, then exits with status 1.

### Keys

| Key | Action |
|---|---|
| Enter | Submit. While the Agent is idle this is `followup`; while it is running this is `steer`. |
| Esc | Abort the running turn. In a modal it denies an approval or defers a question. It also cancels a pending Ctrl+C exit confirmation. |
| Ctrl+C | First press arms exit and shows the hint; a second press within three seconds restores the screen and exits. |
| ↑ / ↓ | Editor history at the first and last visual line. |
| Shift+Enter, Ctrl+Enter, Alt+Enter | Insert a newline (terminal support varies). |
| Arrow keys, Backspace, Delete, Ctrl+A/E/K/U/W | Editor movement and editing. |
| Arrow keys, Enter, Esc | Move and select in a modal list. |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`src/startup.ts` is the `tui-startup` row. Its commander command declares the flag family and an action that publishes `tuiStartup` through `ctx.provide`; `parseCmdline` from `@deepseek-ai/dsh-cmdline` runs that action. An invalid `--theme` or empty `--resume` is a usage error and publishes nothing.

`src/index.ts` is the `tui-app` row. It registers its approval and question answerers immediately, waits for `ctx.appReady.onReady(...)`, refuses a non-TTY stdout, opens or resumes the Agent from the configured default model (retrying briefly while the agent-loop factory mounts), replays a resumed Session's log through the projection, starts pi-tui, and owns shutdown. Resume replay reads the persisted history through `sessionQuery.readSession`; the service is mounted by `dsh-base`. Disposal, SIGINT/SIGTERM, and the boot path share one termination state; every await in `boot()` re-checks it, so a shutdown during the open or replay never lets `ui.start()` take the terminal. `ProcessTerminal` owns stdin raw mode; every exit path stops the renderer before `ctx.appExit`.

The implementation is split so the terminal is not needed for most tests:

| Layer | Responsibility |
|---|---|
| `src/projection/` | Pure fold from durable Session events to display blocks, plus tool-call/result summaries. |
| `src/host/` | DSH access: Agent creation/resume, prompt delivery, event subscriptions, and the two waterfall answerers. |
| `src/app/` | pi-tui composition: transcript, status line, editor, modal dialogs, and the theme. |
| `src/term/` | The `ProcessTerminal` join and the pi-tui and commander import joins. |

The transcript is derived only from recorded events (`user/message`, `assistant/message`, `tool/call`, `tool/result`, `turn/start`, `turn/end`, `session/title`) and a transient live-text buffer fed by `agent/assistant-stream`. Resume replay and live updates use the same projection; a sequence-number guard makes duplicate delivery harmless. Block ids derive from the Session sequence.

The approval modal offers Allow once and Deny. The question modal renders each question's options through `SelectList`, one question at a time, and returns `{ answers: [{ id, selected }] }`. A question with no options, or Escape, defers to `next()` rather than inventing an answer. Requests addressed to another Agent are delegated, so a future multi-session host keeps working.

Tests live in `tests/` and run with:

```sh
./node_modules/.bin/vitest run packages/fork/tui/tests
```

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [fork group](../README.md) — the package map for this group.
- [`anago-tui`](../anago-tui/README.md) — the bundle that mounts these rows.
- [Design of the bundled plugins](../../../ANAGO_PLUGINS_DESIGN.md) — chapter 6 is this plugin's design.

-----

<a id="model-experience"></a>
## Model Experience

None, as the terminal UI renders session state for a human and contributes no prompt, tool schema, or session event.

#### KV Cache effect

None. The package does not alter the system prompt or any part of the stable request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Tool cards are not implemented.** The transcript shows a tool name, one-line argument summary, and the first result line. There are no expandable cards, diffs, durations, or `presentationMeta` projections.
- **No model picker or provider picker.** The configured default and `--model`/`--provider` set the Agent's start values; changing the route in-session needs a restart.
- **A model route must come from the profile or the flags.** With no `agentDefaultModel` and no complete `--provider`/`--model` pair, the app exits with one guidance line instead of guessing a provider.
- **No session picker.** `--resume <sessionId>` is the only way to reopen a Session; listing, deleting, and switching Sessions are absent.
- **Resume replay requires `sessionQuery`.** A profile that omits the service fails the resume with a stderr line instead of showing history; `dsh-base` mounts it, so the shipped `tui` profile is unaffected.
- **No images.** `Image`, clipboard image paste, and attachment rendering are absent; image content is ignored by the transcript.
- **Themes are limited to dark and light, chosen at startup.** There is no `/theme` switch, no `SettingsList`, and no custom palette; themes beyond dark and light are deferred.
- **No mouse scroll or selection.** The alternate screen relies on pi-tui defaults and has no TUI-specific mouse behavior; the main screen leaves scrolling to the terminal.
- **No metrics.** Context tokens, cost, usage, and per-turn timing are not shown.
- **Approval is one-shot only.** The DSH approval protocol has no session-scoped grant, so the modal cannot offer "allow for session"; only Allow once and Deny exist.
- **Question handling is single-select only.** Multi-select questions record only the highlighted option, and free-text ("Other") answers are not implemented. A question with no options is deferred to the next answerer.
- **No modal cancellation on request abort.** An aborted `approval/request` or `user-questions/request` does not dismiss an already-open modal.
- **No slash commands, completion, or `@` file references.** The editor has its built-in history and paste markers but no command or path provider.
- **No reasoning blocks, jobs, subagents, goals, schedules, compaction controls, or command bridge.** Only the plain conversation, tools, errors, and notices render.
- **No Windows ConPTY smoke test.** pi-tui supports win32, but this slice is only tested through the fake terminal and the non-TTY path.
- **Only stdout is checked for TTY.** A redirected stdin with a TTY stdout is not rejected.
- **The dependencies need an install.** `@earendil-works/pi-tui` and `commander` are declared in `package.json`; the workspace `pnpm install` links them. `src/term/pi-tui.ts` is the only import site for the terminal library.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

- This package deliberately has no `cordis.patch.yml`; the `anago-tui` bundle owns the rows.
- `src/term/pi-tui.ts` re-exports `@earendil-works/pi-tui` and `src/term/commander.ts` re-exports `commander`, both by bare specifier. Each is the single import site for its dependency, so an upgrade changes one line and one lockfile entry. A source checkout needs `pnpm install` (or the equivalent workspace links) before the package resolves them.
- The package type-checks with `./node_modules/.bin/tsc -p packages/fork/tui/tsconfig.json --emitDeclarationOnly --outDir /tmp/tui-types`.
- Approval and question waterfalls are registered at row mount, but the presenter is only offered once the renderer has started, so an early request delegates instead of opening an invisible modal.
- `turn/end` reasons carry the only durable failure record; `agent/error` supplies failures with no in-turn position. Both become error rows.
</details>
