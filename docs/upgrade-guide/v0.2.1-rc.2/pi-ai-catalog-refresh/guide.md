---
kind: upgrade-guide
description: "pi-ai 1.4.0 refreshes every provider model catalog, drops cross-model thinking on replay, and sends Codex tool additions as additional_tools."
---

# pi-ai 1.4.0 replaces the provider catalogs

English | [中文](guide.zh.md)

## Change

The bundled `@earendil-works/pi-ai` moves from 1.1.0 to 1.4.0. Every pi-ai provider route now advertises the 1.4.0 catalog, so model ids and counts change: `openai-codex` loses `gpt-5.5` and `gpt-5.3-codex-spark`, `github-copilot` gains `claude-haiku-5.5` and `gemini-4-argon`, and other providers move to their current entries.

Two request behaviors follow the same upgrade. Replaying assistant thinking produced by a different model now drops those blocks instead of restating them as visible text. Codex routes with additional-tool support send tool additions as `additional_tools` input entries instead of tool-search calls, so a transcript captured on 1.1.0 replays through the new wire form.

A settings document, `agent-default-model` row, agent preset, or script that names a removed model id no longer resolves, and a model picker shows the 1.4.0 entries for every route.

## Migration

1. Reinstall and rebuild the workspace so the new dependency and local patch apply: `pnpm install && pnpm run build:artifacts`.
2. For every `agent-default-model`, preset, or profile that names a pi-ai model, replace a removed id with a current one from the same provider. For `openai-codex`, `gpt-5.6-sol` or `gpt-6.1-sol` are current replacements for `gpt-5.5`.
3. If a stored Session switches providers and relied on readable thinking from the previous model, keep that context in the assistant text: the replay now omits cross-model thinking.
4. Confirm the migration by opening the model picker on a pi-ai route, checking the expected 1.4.0 models appear, and completing one chat turn on the selected model.
