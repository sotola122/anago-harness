---
description: "Fork-owned policy packages for Anago Harness."
kind: "package-group"
---

# fork/ — fork policy

English | [中文](README.zh.md)

## Summary

The fork group holds the packages this fork adds to the product: private policy, the host capabilities shipped in `anago-core`, the browser cards in `anago-web`, and the terminal application in `anago-tui`. `fork-policy` installs the Node egress guard and the profile patch lists the boot composer reads. The shipped `web`, `headless`, and `tui` profile templates select the `anago-*` bundles.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`fork-policy`](fork-policy/README.md) | Node egress guard and fork profile patch lists | (library imported by app boot) |
| [`knowledge-common`](knowledge-common/README.md) | Shared knowledge-store helpers for memory and the LLM wiki | (library) |
| [`memory`](memory/README.md) | Global and workspace memory, the `memory` tool, and injected snapshots | `memory` |
| [`llm-wiki`](llm-wiki/README.md) | Project and global wiki tools, lint, and the wiki skill | `llm-wiki` |
| [`response-language`](response-language/README.md) | Fixed Japanese-response system-prompt section | `response-language` |
| [`subagent-cursor`](subagent-cursor/README.md) | Cursor Agent CLI subagent provider | `subagent-cursor` |
| [`subagent-pi`](subagent-pi/README.md) | Pi coding agent subagent provider | `subagent-pi` |
| [`web-search-brave`](web-search-brave/README.md) | Brave search provider for `ctx.web` | `web-search-brave` |
| [`web-search-exa`](web-search-exa/README.md) | Exa search provider that resolves its key through `ctx.credentials` | `web-search-exa` |
| [`web-search-credentials`](web-search-credentials/README.md) | Shared API-key lookup order for the search providers | (library) |
| [`client-ui-settings-web-search`](client-ui-settings-web-search/README.md) | Exa and Brave search settings cards on the Plugins page | `ui-settings-web-search-providers` |
| [`tui`](tui/README.md) | Terminal UI application plugin built on the pi terminal UI library | `tui-startup`, `tui-app` |
| [`anago-core`](anago-core/README.md) | Profile bundle: the host rows above | (bundle) |
| [`anago-web`](anago-web/README.md) | Profile bundle: the browser rows above | (bundle) |
| [`anago-tui`](anago-tui/README.md) | Profile bundle: the terminal rows above | (bundle) |

<a id="related-documentation"></a>
## Related documentation

- [Project guideline](../../PROJECT_GUIDELINE.md) — denylist, guard hook, and static egress scan.
- [Boot package](../boot/app-boot/README.md) — the profile composer that imports the guard.
- [Design of the bundled plugins](../../ANAGO_PLUGINS_DESIGN.md) — package split, settings cards, and terminal UI.

<a id="dev-note"></a>
## Dev Note

None.
