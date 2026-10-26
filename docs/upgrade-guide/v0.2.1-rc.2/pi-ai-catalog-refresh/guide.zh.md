---
kind: upgrade-guide
description: "pi-ai 1.4.0 刷新所有提供方的模型目录，回放时丢弃跨模型思考，并将 Codex 工具追加改为 additional_tools。"
---

# pi-ai 1.4.0 替换提供方目录

[English](guide.md) | 中文

## 变更

内置的 `@earendil-works/pi-ai` 从 1.1.0 升级到 1.4.0。所有 pi-ai 提供方路由现在公布 1.4.0 目录，因此模型 id 和数量会变化：`openai-codex` 移除 `gpt-5.5` 和 `gpt-5.3-codex-spark`，`github-copilot` 新增 `claude-haiku-5.5` 与 `gemini-4-argon`，其他提供方也切换到当前条目。

同一升级带来两种请求行为变化。回放由其他模型生成的助手思考时，现在会丢弃这些块，而不是将其重述为可见文本。支持追加工具的 Codex 路由改用 `additional_tools` 输入项发送工具追加，而不是工具搜索调用，因此在 1.1.0 上捕获的会话会以新的线格式回放。

命名已移除模型 id 的设置文档、`agent-default-model` 行、代理预设或脚本将无法解析，模型选择器会为每个路由显示 1.4.0 的条目。

## 迁移

1. 重新安装并构建工作区，以便应用新依赖和本地补丁：`pnpm install && pnpm run build:artifacts`。
2. 对于每个命名 pi-ai 模型的 `agent-default-model`、预设或配置，将已移除的 id 替换为同一提供方的当前条目。对 `openai-codex`，`gpt-5.6-sol` 或 `gpt-6.1-sol` 是 `gpt-5.5` 的当前替代。
3. 如果已存储的 Session 切换提供方并依赖上一模型的可读思考，请将该上下文保留在助手文本中：回放现在会省略跨模型思考。
4. 打开 pi-ai 路由的模型选择器，确认出现预期的 1.4.0 模型，并在所选模型上完成一次聊天回合以确认迁移成功。
