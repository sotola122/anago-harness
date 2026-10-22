---
description: "The terminal application layer for anago profiles: the pi-based TUI and the ask-user tool it answers."
kind: "package-bundle"
---

# @anago-harness/anago-tui

English | [中文](README.zh.md)

## Summary

The terminal application layer for anago profiles: the pi-based TUI and the ask-user tool it answers. The package carries no runtime code; its substance is `cordis.patch.yml`, declared by the `dsh.bundle.patch` manifest field.

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

Mount it only in a terminal profile. The `tui` profile template selects it; the Web profile must not, because the app row takes over the terminal.

| Row | Package |
|---|---|
| `tui-startup` | `@anago-harness/tui` (startup entry) |
| `tui-app` | `@anago-harness/tui` |
| `tool-ask-user` | `@deepseek-ai/dsh-tool-ask-user` |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The profile composer reads the bundle's patch and applies it after the upstream bundle layers, then applies the profile's own patch. A non-insert entry replaces the targeted row's `config` wholesale. Rows stay switchable from the Plugins page; turn one off in `cordis.patch.yml` with `- id: <row>` and `disabled: true`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [fork group](../README.md) — the package map for this group.
- [Design of the bundled plugins](../../../ANAGO_PLUGINS_DESIGN.md) — package split and settings cards.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through each inserted row's package, which owns that row's model-facing behavior.

#### KV Cache effect

The bundle itself adds no request prefix; each inserted row's package owns any cache effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The bundle is private to this fork and is not published to npm.
- Its rows are ordinary profile rows; a deployment that removes the bundle also removes every capability it mounts.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.
</details>
