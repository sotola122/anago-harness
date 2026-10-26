---
kind: upgrade-guide
description: "随附配置不再挂载 subagent_cursor 与 subagent_pi 工具。"
---

# 移除 Cursor 与 Pi 的 subagent 工具

[English](guide.md) | 中文

## 变更

`@anago-harness/anago-core` 不再插入 `subagent-cursor`、`tool-subagent-cursor`、`subagent-pi` 或 `tool-subagent-pi`。挂载该捆绑包的配置，包括 `web` 与 `headless`，不再提供 `subagent_cursor` 或 `subagent_pi`。

`@anago-harness/subagent-cursor` 与 `@anago-harness/subagent-pi` 已不在本仓库中。配置 patch 若仍命名这些行 id，不能恢复这些工具；加载器报告 `patch: entry "<id>" not found` 并跳过该 patch。

模型、skill（技能）或脚本若调用其中任一工具，会收到 `ToolNotFoundError`（`UNKNOWN_TOOL`），消息为 `unknown tool "subagent_cursor"` 或 `unknown tool "subagent_pi"`。其余委派工具不变。

## 迁移

1. 从 skill、提示词和自动化中移除对 `subagent_cursor` 与 `subagent_pi` 的调用。改用 `subagent`，或该配置仍挂载的其他工具。
2. 在配置的 `cordis.patch.yml` 与 `$DSH_HOME/cordis.patch.yml` 中，删除 `id` 为 `subagent-cursor`、`tool-subagent-cursor`、`subagent-pi` 或 `tool-subagent-pi` 的条目，包括 `disabled: true` 的覆盖。
3. 若配置的 `package.json` 列出 `@anago-harness/subagent-cursor` 或 `@anago-harness/subagent-pi`，删除这些依赖并重新安装。
4. 用 `dsh --profile headless --dump-config` 确认：stderr 没有 `patch: entry "subagent-cursor" not found`（或 Pi 的 id），配置树中没有这四个 id，并且新 Session 的工具列表中没有 `subagent_cursor` 与 `subagent_pi`。
