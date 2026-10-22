---
description: "Japanese language pack for the anago Web UI: registers the ja locale and full-key Japanese dictionaries for 49 namespaces covering the conversation screen, chat transcript, approvals and questions, agent presets, workspace and session list, layout and sidebar controls, settings pages, the Models page and model selector, permissions, slash commands, skills, background jobs, goals, schedules, feedback, the right sidebar panels, the Plugins page, and the fork's web-search cards, falling back to English per key."
kind: "package-reference"
---

# @anago-harness/client-locale-ja

English | [中文](README.zh.md)

## Summary

Use `@anago-harness/client-locale-ja` to make the Web GUI Japanese. The browser half registers the `ja` locale and full-key Japanese dictionaries for 49 namespaces (2032 keys) across the conversation screen, chat transcript, approvals and questions, settings pages, the Models page, permissions, commands, skills, jobs, goals, schedules, feedback, the right sidebar, the Plugins page, and the fork's web-search cards. Registrations ride `ctx.effect`, so unloading removes the language and every dictionary. A namespace or key the pack omits falls back per key to the shipped English copy, so the UI never renders an empty label.

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

- `conversation` (373 keys) — the conversation screen: the hero, composer placeholders and hints, attachments, tool rows, detail panels, the message queue, and terminal cards.
- `chat` (191 keys) — the transcript: step and turn status lines, retry and failure notices, token statistics, context and compaction rows, and the chat settings rows.
- `approval` (5 keys) and `question` (31 keys) — approval cards and escalations, question cards, plan review actions, and the reply controls.
- `settings.agentPreset` (47 keys) — the Standard, PTC, Minimal, and Creator mode labels and descriptions, the preset picker section, and the mode guide.
- `workspace` (119 keys) — the workspace picker, session rows and groups, view, sort, and filter controls, session search, rename and delete dialogs, and archive confirmation.
- `sidebar` (5 keys) and `shortcuts.layout` (1 key) — new-session labels, the sidebar toggle, global panel labels, and the layout command label.
- `common` (41 keys) — the shared shell vocabulary: buttons, dialogs, copy controls, and generic errors.
- `settings` (41 keys) and `settings.locale` (1 key) — the settings shell and General page, including the Language row.
- `settings.shell` (14 keys) — the shell-executor settings page.
- `settings.pluginInventory` (37 keys) and `pluginManager` (220 keys) — the Plugins page inventory tab, plugin rows, and install dialog.
- `settings.webSearchProviders` (35 keys) — the fork's Exa and Brave web-search cards.
- `settings.models` (134 keys) and `model` (23 keys) — the Models page: provider cards and editor, API-key and base-URL fields, model and reasoning-level editing, the welcome and onboarding notices, and the model and effort selector.
- `permission.access` (12 keys) and `settings.permission` (12 keys) — the default-permission row, its Full access confirmation, and the settings card.
- `command` (28 keys) — the slash-command menu, including the command labels, descriptions, search, and empty states.
- `skill` (8 keys), `job` (40 keys), and `goal` (12 keys) — the skill loading row, the background-job roster and record panels, and the goal bar.
- `schedule.catalog` (70 keys) and `schedule.manager` (188 keys) — the reminder catalog, the automation task list and detail views, delivery records, timing and cron editors, and the delete confirmation.
- `feedback` (20 keys) — the response rating actions and the feedback dialog with its categories and errors.
- `settings.theme` (25 keys), `settings.plugins` (5 keys), `settings.agentLoop` (12 keys), `settings.subagent` (35 keys), and `session-log-deepseek` (4 keys) — the Appearance and font rows, the Built-in plugins section, and the Agent loop, Subagent, and Session-log upload pages.
- `reference` (15 keys), `secretMask` (2 keys), `workflowRun` (18 keys), `plan` (17 keys), `slash.menu` (9 keys), `deepseek-model-label-1017` (1 key), and `directory-browser` (13 keys) — the `@` reference menu, the credential reveal control, the workflow lifecycle card, the plan chip and preview, the trigger menu, the model badge, and the workspace directory picker dialog.
- `sidebarRight` (34 keys), `sidebarTerminal` (28 keys), `sidebarFiles` (17 keys), `sidebarDocumentPreview` (22 keys), `sidebarCodePreview` (3 keys), `sidebarExcel` (15 keys), `documentHtml` (4 keys), `sidebarImage` (11 keys), `documentMarkdown` (4 keys), `sidebarOffice` (15 keys), and `sidebarPdf` (15 keys) — the right Sidebar dock, terminal tab, workspace file tree, and the document tab with its per-format renderers.

A key the pack does not translate falls through to English per key; a namespace it does not register keeps the English dictionary entirely. Partial coverage therefore never leaves an empty label.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Node half is an empty `apply`, present so the package holds a Loader row whose bare specifier the client module system serves the `./client` bundle for. The browser half declares `inject = ['locale']` and registers the language and each namespace inside `ctx.effect`, so teardown removes the `ja` definition and every dictionary. Dictionaries are flat key-to-template objects under `src/client/`; `common` is typed against the locale package's `CommonKey` union, and 42 of the 49 namespaces mirror the `en` dictionary of the client package that owns them. `tests/fixtures/english-keys.json` records those English key sets, and the application test fails when a mirrored namespace gains, renames, or loses a key. Lookup stays in the locale service: it walks `ja` then `en` per key in the requested namespace, then repeats that chain in `common`.

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

- **Partial translation with English fallback.** Seven namespaces are registered in English only: `settings.account` (the Account page and the Models page's sign-in dialog), `shortcuts`, `subagent`, `deliverables`, `open-in-app`, `pluginMarket`, and `trajectory`; `sidebarBrowser` stays English because the Web profile does not mount it. `pluginManager.installGuideIdExample` is deliberately omitted because the package name reads the same in both languages. Any other key this pack omits displays the shipped English copy through the locale service's per-key fallback chain until a later pass adds it.
- **No server-rendered text.** The pack registers browser dictionaries only; it does not translate the served HTML, `<title>`, or any text produced before the client mounts.
- **UI-only coverage.** Tool results, prompts, CLI output, and other model-facing text are not translated; the pack changes how the Web GUI renders product copy, not what the model receives.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This package sits outside `packages/client/*`, so the client package verifier does not inspect it; its application test keeps the language registration, the dictionary lookup, the English fallback, the teardown behavior, and key parity with English honest. The `common` dictionary is checked against `CommonKey` at compile time; feature dictionaries are plain objects because the owning client packages are not declared runtime dependencies. Add a namespace by importing its dictionary in `src/client/index.ts`, appending it to `DICTIONARIES`, and recording its English keys in `tests/fixtures/english-keys.json`.
</details>
