# Fork notes

English | [中文](fork.zh.md)

## What this repository is

Anago Harness is an unofficial fork of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), an open-source agent harness developed by [DeepSeek AI](https://deepseek.com). The fork keeps the upstream architecture and license, is not affiliated with or endorsed by DeepSeek AI, and records its design baseline in [PROJECT_GUIDELINE.md](../PROJECT_GUIDELINE.md).

## What stays upstream-compatible

Package names (`@deepseek-ai/dsh-*`), the `dsh` command, `DSH_*` environment variables, and the `~/.dsh` home directory keep their upstream names, so upstream plugins, profiles, configurations, and documentation references keep working.

## What the fork changes

`@anago-harness/fork-policy` installs an egress guard that refuses the hosts the harness contacts on its own; `api.deepseek.com` stays reachable. Upstream publication, preview, issue, and approval workflows are not run from this repository. Changes stay in fork-only files and a small set of hook points so upstream updates remain mergeable.

The fork ships its own capabilities as private packages under `packages/fork/` and mounts them through four bundles: `@anago-harness/anago-core` (memory, the LLM wiki, the Japanese-response instruction, and the Exa and Brave search providers), `@anago-harness/anago-web` (the Exa and Brave search settings cards), `@anago-harness/xai-oauth` (the `/xai-*` commands that sign in to xAI through the pi-ai OAuth flow), and `@anago-harness/copilot-oauth` (the `/copilot-*` commands that sign in to GitHub Copilot through the pi-ai OAuth flow). The `web` and `headless` profile templates select the core bundle, `web` also selects the browser bundle, and a profile selects `xai-oauth` or `copilot-oauth` when it should sign in to that provider. The terminal surface is the separately installed dsh-TUI bundle, not a fork package.

The fork composition is recorded in keyless snapshots under `snapshots/session/`: `anago-memory`, `anago-wiki`, and `anago-search` replay the injected memory snapshot and `memory` tool, the wiki existence notice, and the Brave-over-Exa search selection from committed Sessions, so those rows are verified without a model key.

## What comes next

[PROJECT_GUIDELINE.md](../PROJECT_GUIDELINE.md) plans the remaining fork work: product branding, Japanese fonts, the `ash` command, and desktop installers. [ANAGO_PLUGINS_DESIGN.md](../ANAGO_PLUGINS_DESIGN.md) records the package split and the settings-card design.

## Documentation and license

The [upstream documentation](https://deepseek-harness.github.io/deepseek-harness/) remains the reference for the code. The fork is distributed under the upstream MIT license; see [LICENSE](../LICENSE) and [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
