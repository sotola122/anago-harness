---
description: "Terminal UI application plugin for the anago harness, built on the pi terminal UI library."
kind: "package-reference"
---

# @anago-harness/tui

English | [中文](README.zh.md)

## Summary

The anago terminal application. It opens one DSH Agent, renders the durable Session transcript in a pi terminal UI with compact tool cards and collapsed reasoning, streams assistant text, shows the turn's token usage, and answers the approval and user-question waterfalls with modals. A `/` completion popup covers the TUI's own commands, Ctrl+P switches provider/model routes for later turns, Ctrl+R resumes a stored Session, and Ctrl+O expands the newest card. The `anago-tui` bundle owns the profile rows; this package owns their behavior.

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

### Commands

Type `/` in the editor to open the completion popup; Tab or Enter accepts the highlighted name. Commands run locally and are never sent to the model.

| Command | Action |
|---|---|
| `/help` | List the commands and the key reference in the transcript. |
| `/model` | Open the model picker, which lists the Host LLM catalog and applies the chosen route to later turns. |
| `/clear` | Close the current Agent and start a new Session in the same UI. |
| `/resume` | List the profile's stored Sessions and continue the selected one; a row another process holds is dimmed and refuses selection. |
| `/quit` | Restore the terminal and exit. |

### Keys

| Key | Action |
|---|---|
| Enter | Submit. While the Agent is idle this is `followup`; while it is running this is `steer`. |
| Esc | Abort the running turn. In a modal it denies an approval or defers a question. It also cancels a pending Ctrl+C exit confirmation. |
| Ctrl+C | First press arms exit and shows the hint; a second press within three seconds restores the screen and exits. |
| Ctrl+P | Open the provider/model picker. |
| Ctrl+R | Open the stored-Session picker. |
| Ctrl+O | Expand or collapse the newest tool or reasoning card. |
| Tab | Accept the highlighted `/` command completion. |
| ↑ / ↓ | Editor history at the first and last visual line; move in a modal list or picker. |
| Shift+Enter, Ctrl+Enter, Alt+Enter | Insert a newline (terminal support varies). |
| Arrow keys, Backspace, Delete, Ctrl+A/E/K/U/W | Editor movement and editing. |
| Enter, Esc | Select or cancel in a modal list; Enter on a dimmed row shows its refusal instead of choosing it. |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`src/startup.ts` is the `tui-startup` row. Its commander command declares the flag family and an action that publishes `tuiStartup` through `ctx.provide`; `parseCmdline` from `@deepseek-ai/dsh-cmdline` runs that action. An invalid `--theme` or empty `--resume` is a usage error and publishes nothing.

`src/index.ts` is the `tui-app` row. It registers its approval and question answerers immediately, waits for `ctx.appReady.onReady(...)`, refuses a non-TTY stdout, opens or resumes the Agent from the configured default model (retrying briefly while the agent-loop factory mounts), replays a resumed Session's log through the projection, starts pi-tui, and owns shutdown. Opening a Session and every later switch share one `openInto` path: it opens the new handle first, installs its model-selection listeners and event subscriptions, resets the transcript and footer, releases the previous Agent, and replays history for a resume. A failed open, `--resume` included, leaves the current Agent, its listeners, and its transcript in place. Session switches are serialized, and every await re-checks the shared termination state. `ProcessTerminal` owns stdin raw mode; every exit path stops the renderer before `ctx.appExit`.

The row's `TuiHost` callbacks connect the screen to DSH: `listModelOptions` reads the LLM catalog, `resolveModelRoute` validates a picked route, `installModelSelection` applies it to the live Agent for later prompt assembly, and `listSessionOptions` reads the same `sessionQuery` corpus the resume replay uses.

The implementation is split so the terminal is not needed for most tests:

| Layer | Responsibility |
|---|---|
| `src/projection/` | Pure fold from durable Session events to display blocks, plus tool-card, usage, and reasoning projections. |
| `src/host/` | DSH access: Agent creation/resume, prompt delivery, event subscriptions, model routes, Session listing, and the two waterfall answerers. |
| `src/app/` | pi-tui composition: transcript, status line, editor, command completion, modal dialogs, pickers, and the theme. |
| `src/term/` | The `ProcessTerminal` join and the pi-tui and commander import joins. |

The transcript is derived only from recorded events (`user/message`, `assistant/message`, `tool/call`, `tool/result`, `turn/start`, `turn/end`, `session/title`) and transient live buffers fed by `agent/assistant-stream` text and reasoning deltas. Resume replay and live updates use the same projection; a sequence-number guard makes duplicate delivery harmless. Block ids derive from the Session sequence. `applyTranscriptEvent` reads reasoning blocks and `usage` from `assistant/message`, and `tool/result`'s persisted `meta` supplies card facts such as a working directory, a read window, or diff counts; an unrecognized payload falls back to the result text.

A tool card shows the tool name, a one-line invocation summary, a detail line such as `$ command`, status, duration, and a collapsed result preview. Ctrl+O toggles the newest tool or reasoning card. Reasoning is collapsed to its first line and character count; the footer adds `in … · out …` for the current or most recent turn only when the provider reported usage. The model picker groups catalog models by provider and filters as you type; choosing a route installs it on the Agent's model-selection listeners without recreating the Agent. The Session picker dims a row whose `disabledReason` is set, shows that reason in the detail column, and refuses Enter with a `cannot select` notice instead of opening it.

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

- **A model route must come from the profile or the flags to start.** With no `agentDefaultModel` and no complete `--provider`/`--model` pair, the app exits with one guidance line instead of guessing a provider; `/model` can only switch to a route the Host LLM catalog advertises.
- **The model picker is session-local and has no reasoning control.** It does not save the chosen route as the profile default, offers no effort selector, and omits providers whose adapter publishes no catalog (except the current route).
- **Session switching lists header metadata only.** `/resume` shows age, directory, and id, caps the list at 50 newest Sessions, and omits titles, deletion, renaming, and search.
- **Resume replay requires `sessionQuery`.** A profile that omits the service fails the resume with a stderr line instead of showing history; `dsh-base` mounts it, so the shipped `tui` profile is unaffected.
- **A failed Session switch keeps the current Agent.** `/resume` and `/clear` open the next Agent before releasing the current one; when the open fails, the error is shown and the Session already on screen stays usable. A `--resume` startup failure still exits with status 1 because no Session is open yet.
- **Disabled Session rows come from the writer lease.** `listSessionOptions` probes `SessionPersistence.ownership` for each listed Session; one another DSH process holds is dimmed with its reason and cannot be selected. The probe is advisory — a lease lost between listing and opening is refused by the same open path, and `--resume` of a held Session exits with the same reason.
- **Tool cards cover known tool families.** `tool/result.meta` is read structurally for paths, read windows, diffs, jobs, and exit codes; unknown payloads fall back to the result text. Diffs are counted, not rendered as hunks, and there is no image or syntax-highlighted output.
- **No images.** `Image`, clipboard image paste, and attachment rendering are absent; image content is ignored by the transcript.
- **Themes are limited to dark and light, chosen at startup.** There is no `/theme` switch, no `SettingsList`, and no custom palette; themes beyond dark and light are deferred.
- **No mouse scroll or selection.** The alternate screen relies on pi-tui defaults and has no TUI-specific mouse behavior; the main screen leaves scrolling to the terminal.
- **No context or cost metrics.** The footer shows the turn's input and output counts only when the provider reports usage; context tokens, cost, and per-turn timing are absent.
- **Approval is one-shot only.** The DSH approval protocol has no session-scoped grant, so the modal cannot offer "allow for session"; only Allow once and Deny exist.
- **Question handling is single-select only.** Multi-select questions record only the highlighted option, and free-text ("Other") answers are not implemented. A question with no options is deferred to the next answerer.
- **No modal cancellation on request abort.** An aborted `approval/request` or `user-questions/request` does not dismiss an already-open modal.
- **Slash commands are TUI-owned only.** `/help`, `/model`, `/clear`, `/resume`, and `/quit` exist; there is no bridge to `ctx.commands`, no argument completion, and no `@` file references.
- **No jobs, subagents, goals, schedules, compaction controls, or command bridge.** Only the plain conversation, tool cards, reasoning, usage, errors, and notices render.
- **Reasoning is provider text, not a thinking UI.** Collapsed summaries show what the provider records; there are no live step timelines or per-step reasoning navigation.
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
- The model picker installs a `ModelSelectionRef` on the Agent scope; the reference is per-Agent, so a Session switch installs a fresh one. The route is not written back to `agentDefaultModel`, which keeps a TUI experiment from changing the profile default.
</details>
