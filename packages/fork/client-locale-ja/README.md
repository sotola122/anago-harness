---
description: "Japanese language pack for the anago Web UI: registers the ja locale and partial Japanese dictionaries for the shared shell vocabulary, the settings and Plugins pages, and the fork's web-search cards, falling back to English per key."
kind: "package-reference"
---

# @anago-harness/client-locale-ja

English | [中文](README.zh.md)

## Summary

Use `@anago-harness/client-locale-ja` to add 日本語 to the Web GUI language selector. The browser half registers the `ja` locale and Japanese dictionaries for the shared shell vocabulary, the settings shell and General page, the Plugins page, and the fork's Exa and Brave search cards. Registrations ride `ctx.effect`, so unloading the plugin removes the language and every dictionary. Translation is deliberately partial: a namespace or key the pack omits resolves through the locale service's per-key fallback chain to the shipped English copy, so the UI never renders an empty label while coverage grows.

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

- `common` — the shared shell vocabulary: buttons, dialogs, copy controls, and generic errors.
- `settings` — the settings shell and General page, including the Language row.
- `settings.shell` — the shell-executor settings page.
- `settings.pluginInventory` and `pluginManager` — the Plugins page inventory tab, plugin rows, and install dialog.
- `settings.webSearchProviders` — the fork's Exa and Brave web-search cards.

A key the pack does not translate falls through to English per key; a namespace it does not register keeps the English dictionary entirely. Partial coverage therefore never leaves an empty label.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Node half is an empty `apply`, present so the package holds a Loader row whose bare specifier the client module system serves the `./client` bundle for. The browser half declares `inject = ['locale']` and registers the language and each namespace inside `ctx.effect`, so teardown removes the `ja` definition and every dictionary. Dictionaries are flat key-to-template objects under `src/client/`; `common` is typed against the locale package's `CommonKey` union, and each feature namespace mirrors the `en` dictionary of the client package that owns it. Lookup stays in the locale service: it walks `ja` then `en` per key in the requested namespace, then repeats that chain in `common`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Client locale service](../../client/locale/README.md) — the registry, fallback chain, and language-pack contract this package implements.
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

- **Partial translation with English fallback.** Only the namespaces listed above are translated. Any other namespace, and any key this pack omits, displays the shipped English copy through the locale service's per-key fallback chain until a later pass adds it.
- **No server-rendered text.** The pack registers browser dictionaries only; it does not translate the served HTML, `<title>`, or any text produced before the client mounts.
- **UI-only coverage.** Tool results, prompts, CLI output, and other model-facing text are not translated; the pack changes how the Web GUI renders product copy, not what the model receives.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This package sits outside `packages/client/*`, so the client package verifier does not inspect it; its application test keeps the language registration, the dictionary lookup, the English fallback, and the teardown behavior honest. The `common` dictionary is checked against `CommonKey` at compile time; feature dictionaries are plain objects because the owning client packages are not declared runtime dependencies. Add a namespace by importing its dictionary in `src/client/index.ts` and appending it to `DICTIONARIES`.
</details>
