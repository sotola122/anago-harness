---
kind: upgrade-guide
description: "随附的 web 与 headless 配置现在挂载 anago 捆绑包，并新增 tui 配置。"
---

# 随附配置中的 anago 捆绑包

[English](guide.md) | 中文

## 变更

`web` 与 `headless` 配置模板现在选择 `@anago-harness/anago-core`，`web` 模板还选择 `@anago-harness/anago-web`。

这些捆绑包加入了上游模板没有的行：`anago-core` 中的 `memory`、`llm-wiki`、`response-language`、`subagent-cursor`、`tool-subagent-cursor`、`web-search-exa`、`web-search-brave`；`anago-web` 中的 Exa 与 Brave 搜索设置卡片。`anago-core` 还会把默认搜索提供方设为 `exa`。

模板变化只影响此后新建的配置。已有配置在自己的 `package.json` 中保留捆绑包列表。

## 迁移

1. 重新创建配置以取得新的捆绑包列表，然后重新应用自己的 `cordis.patch.yml` 设置：`dsh rescue --from-default-profile web`，对 `headless` 或 `tui` 同理。在模型、提供方与技能设置恢复之前，保留旧的配置目录。
2. 若选择手工编辑配置，则把 `@anago-harness/anago-core`（Web 另加 `@anago-harness/anago-web`）按上游捆绑包之后的顺序加入 `dsh.profile.bundles` 与 `dependencies`。
3. 在 Plugins 页面通过 **Exa search** 与 **Brave Search** 保存搜索密钥。密钥保存在 `$DSH_HOME/.credentials.yaml` 的 `EXA_API_KEY` 与 `BRAVE_API_KEY` 中，不写入配置文件。
4. 不需要的行在 `cordis.patch.yml` 中禁用（`- id: subagent-cursor`、`disabled: true`），不要删除捆绑包；行由 `anago-core` 拥有。
5. 确认：Plugins 页面显示 `anago-core` 已启用，搜索卡片报告密钥已配置，且一次搜索成功。`tui` 上 `dsh --profile tui` 打开终端界面。
