---
kind: upgrade-guide
description: "The shipped web and headless profiles now mount the anago bundles, and a new tui profile exists."
---

# Anago bundles in the shipped profiles

English | [中文](guide.zh.md)

## Change

The `web` and `headless` profile templates now select `@anago-harness/anago-core`, and the `web` template also selects `@anago-harness/anago-web`.

The bundles add rows the upstream templates do not carry: `memory`, `llm-wiki`, `response-language`, `subagent-cursor`, `tool-subagent-cursor`, `web-search-exa`, and `web-search-brave` in `anago-core`; the Exa and Brave search settings cards in `anago-web`. `anago-core` also sets the default search provider to `exa`.

Because the templates changed, only profiles created after this version start with the bundles. An existing profile keeps the bundle list in its own `package.json`.

## Migration

1. Create the profile again to pick up the new bundle list, then re-apply your own `cordis.patch.yml` settings: `dsh rescue --from-default-profile web`, and the same for `headless` or `tui`. Keep the previous profile directory until the model, provider, and skill settings are back.
2. A profile you prefer to edit by hand must add `@anago-harness/anago-core` (and `@anago-harness/anago-web` for Web) to `dsh.profile.bundles` and to `dependencies`, in that order after the upstream bundles.
3. Store the search keys from the Plugins page, under **Exa search** and **Brave Search**. The keys live in `$DSH_HOME/.credentials.yaml` as `EXA_API_KEY` and `BRAVE_API_KEY`, not in configuration files.
4. Disable a row you do not want in `cordis.patch.yml` (`- id: subagent-cursor`, `disabled: true`) instead of deleting the bundle; `anago-core` holds the rows.
5. Confirm: the Plugins page lists the `anago-core` bundle switched on, the search cards report the keys as configured, and a search succeeds. On `tui`, `dsh --profile tui` opens the terminal UI.
