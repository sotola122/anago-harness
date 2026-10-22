---
description: "Japanese language pack for the anago Web UI: registers the ja locale and full-key Japanese dictionaries for the conversation screen, the chat transcript, approvals and question prompts, agent presets, the workspace picker and session list, layout and sidebar controls, settings, the Plugins page, and the fork's web-search cards, falling back to English per key."
kind: "package-reference"
---

# @anago-harness/client-locale-ja

English | [中文](README.zh.md)

## Summary

Use `@anago-harness/client-locale-ja` to make the Web GUI Japanese. The browser half registers the `ja` locale and full-key Japanese dictionaries for the conversation screen, the chat transcript, approvals and question prompts, agent presets, the workspace picker and session list, layout and sidebar controls, the settings shell, the Plugins page, and the fork's Exa and Brave cards. Registrations ride `ctx.effect`, so unloading the plugin removes the language and every dictionary. Translation stays partial: a namespace or key the pack omits resolves through the locale service's per-key fallback chain to the shipped English copy, so the UI never renders an empty label.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the package as a client row in a Web profile. It has no configuration and no Host-side behavior: activation adds **日本語** to Settings → General and registers the dictionaries listed here. Selecting it writes the locale preference through the service's normal settings path.

- `conversation` — the conversation screen: the hero, composer placeholders and hints, attachments, tool rows, detail panels, the message queue, and terminal cards.
- `chat` — the transcript: step and turn status lines, retry and failure notices, token statistics, context and compaction rows, and the chat settings rows.
- `approval` and `question` — approval cards and escalations, question cards, plan review actions, and the reply controls.
- `settings.agentPreset` — the Standard, PTC, Minimal, and Creator mode labels and descriptions, the preset picker section, and the mode guide.
- `workspace` — the workspace picker, session rows and groups, view, sort, and filter controls, session search, rename and delete dialogs, and archive confirmation.
- `sidebar` and `shortcuts.layout` — new-session labels, the sidebar toggle, global panel labels, and the layout command label.
- `common` — the shared shell vocabulary: buttons, dialogs, copy controls, and generic errors.
- `settings` and `settings.locale` — the settings shell and General page, including the Language row.
- `settings.shell` — the shell-executor settings page.
- `settings.pluginInventory` and `pluginManager` — the Plugins page inventory tab, plugin rows, and install dialog.
- `settings.webSearchProviders` — the fork's Exa and Brave web-search cards.

A key the pack does not translate falls through to English per key; a namespace it does not register keeps the English dictionary entirely. Partial coverage therefore never leaves an empty label.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Node half is an empty `apply`, present so the package holds a Loader row whose bare specifier the client module system serves the `./client` bundle for. The browser half declares `inject = ['locale']` and registers the language and each namespace inside `ctx.effect`, so teardown removes the `ja` definition and every dictionary. Dictionaries are flat key-to-template objects under `src/client/`; `common` is typed against the locale package's `CommonKey` union, and each feature namespace mirrors the `en` dictionary of the client package that owns it. `tests/fixtures/english-keys.json` records those English key sets, and the application test fails when a mirrored namespace gains, renames, or loses a key. Lookup stays in the locale service: it walks `ja` then `en` per key in the requested namespace, then repeats that chain in `common`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Client locale service](../../client/locale/README.md) — the registry, fallback chain, and language-pack contract this package implements.
- [Conversation screen](../../client/ui-conversation/README.md) — the hero, composer, and transcript surface whose `conversation` copy this pack translates.
- [Chat transcript](../../client/ui-chat/README.md) — the message status, retry, and statistics copy this pack translates.
- [Agent presets](../../client/ui-agent-preset/README.md) — the Standard and Creator mode picker this pack translates.
- [Workspace picker](../../client/ui-workspace/README.md) — the workspace and session list whose `workspace` copy this pack translates.
- [Plugins page](../../client/ui-plugin-manager/README.md) — the management surface whose `pluginManager` labels this pack translates.
- [Web-search cards](../client-ui-settings-web-search/README.md) — the fork card whose `settings.webSearchProviders` namespace this pack translates.

-----

<a id="model-experience"></a>
## Model Experience

### Browser-only locale dictionaries

#### What the model sees

Nothing; the `ja` dictionaries reach only the browser render path and add no prompt section, tool definition, or tool result.

#### Token effect

None; no translated string enters a model request or a session event.

#### KV Cache effect

None; the package assembles and sends no provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Partial translation with English fallback.** Only the namespaces listed above are translated. Settings pages for models, commands, skills, jobs, goals, and schedules, along with any other namespace, and any key this pack omits, display the shipped English copy through the locale service's per-key fallback chain until a later pass adds it.
- **No server-rendered text.** The pack registers browser dictionaries only; it does not translate the served HTML, `<title>`, or any text produced before the client mounts.
- **UI-only coverage.** Tool results, prompts, CLI output, and other model-facing text are not translated; the pack changes how the Web GUI renders product copy, not what the model receives.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This package sits outside `packages/client/*`, so the client package verifier does not inspect it; its application test keeps the language registration, the dictionary lookup, the English fallback, the teardown behavior, and key parity with English honest. The `common` dictionary is checked against `CommonKey` at compile time; feature dictionaries are plain objects because the owning client packages are not declared runtime dependencies. Add a namespace by importing its dictionary in `src/client/index.ts`, appending it to `DICTIONARIES`, and recording its English keys in `tests/fixtures/english-keys.json`.
</details>
