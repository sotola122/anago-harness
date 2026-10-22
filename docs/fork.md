# Fork notes

English | [中文](fork.zh.md)

## What this repository is

Anago Harness is an unofficial fork of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), an open-source agent harness developed by [DeepSeek AI](https://deepseek.com). The fork keeps the upstream architecture and license, is not affiliated with or endorsed by DeepSeek AI, and records its design baseline in [PROJECT_GUIDELINE.md](../PROJECT_GUIDELINE.md).

## What stays upstream-compatible

Package names (`@deepseek-ai/dsh-*`), the `dsh` command, `DSH_*` environment variables, and the `~/.dsh` home directory keep their upstream names, so upstream plugins, profiles, configurations, and documentation references keep working.

## What the fork changes

`@anago-harness/fork-policy` installs an egress guard that refuses the hosts the harness contacts on its own; `api.deepseek.com` stays reachable. Upstream publication, preview, issue, and approval workflows are not run from this repository. Changes stay in fork-only files and a small set of hook points so upstream updates remain mergeable.

The fork ships its own capabilities as private packages under `packages/fork/` and mounts them through three bundles: `@anago-harness/anago-core` (memory, the LLM wiki, the Japanese-response instruction, the Cursor subagent, and the Exa and Brave search providers), `@anago-harness/anago-web` (the Exa and Brave search settings cards), and `@anago-harness/anago-tui` (the terminal UI built on the pi terminal UI library). The `web` and `headless` profile templates select the core bundle, `web` also selects the browser bundle, and a new `tui` template selects the core and terminal bundles.

## What comes next

[PROJECT_GUIDELINE.md](../PROJECT_GUIDELINE.md) plans the remaining fork work: product branding, Japanese fonts, the `ash` command, and desktop installers. [ANAGO_PLUGINS_DESIGN.md](../ANAGO_PLUGINS_DESIGN.md) records the package split and the settings-card design.

## Documentation and license

The [upstream documentation](https://deepseek-harness.github.io/deepseek-harness/) remains the reference for the code. The fork is distributed under the upstream MIT license; see [LICENSE](../LICENSE) and [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
