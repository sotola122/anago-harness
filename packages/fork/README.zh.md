---
description: "Anago Harness 的 fork 自有软件包：策略、同捆的主机能力、浏览器卡片与终端应用。"
kind: "package-group"
---

# fork/：fork 软件包

[English](README.md) | 中文

## 概述

fork 组保存本 fork 加入产品的软件包：私有策略、`anago-core` 同捆的主机能力、`anago-web` 的浏览器卡片，以及 `anago-tui` 的终端应用。`fork-policy` 安装 Node 出站守卫，以及启动组合器读取的 profile patch 列表。随附的 `web`、`headless` 与 `tui` 配置模板会选择这些 `anago-*` 捆绑包。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

<a id="packages"></a>
## 包

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`fork-policy`](fork-policy/README.zh.md) | Node 出站守卫与 fork profile patch 列表 | （由 app boot 导入的库） |
| [`knowledge-common`](knowledge-common/README.zh.md) | 记忆与 LLM wiki 共享的知识库助手 | （库） |
| [`memory`](memory/README.zh.md) | 全局与工作区记忆、`memory` 工具与注入的快照 | `memory` |
| [`llm-wiki`](llm-wiki/README.zh.md) | 项目与全局 wiki 工具、lint 与 wiki 技能 | `llm-wiki` |
| [`response-language`](response-language/README.zh.md) | 固定的日语响应系统提示段落 | `response-language` |
| [`subagent-cursor`](subagent-cursor/README.zh.md) | Cursor Agent CLI 子代理提供方 | `subagent-cursor` |
| [`subagent-pi`](subagent-pi/README.zh.md) | Pi coding agent 子代理提供方 | `subagent-pi` |
| [`web-search-brave`](web-search-brave/README.zh.md) | `ctx.web` 的 Brave 搜索提供方 | `web-search-brave` |
| [`web-search-exa`](web-search-exa/README.zh.md) | 通过 `ctx.credentials` 解析密钥的 Exa 搜索提供方 | `web-search-exa` |
| [`web-search-credentials`](web-search-credentials/README.zh.md) | 搜索提供方共享的 API 密钥查找顺序 | （库） |
| [`client-ui-settings-web-search`](client-ui-settings-web-search/README.zh.md) | Plugins 页面上的 Exa 与 Brave 搜索设置卡片 | `ui-settings-web-search-providers` |
| [`client-locale-ja`](client-locale-ja/README.zh.md) | 基于英文回退的日语 UI 语言包 | `anago-locale-ja` |
| [`client-ui-fonts-anago`](client-ui-fonts-anago/README.zh.md) | 日语优先的 Web UI 字体 | `anago-fonts` |
| [`tui`](tui/README.zh.md) | 基于 pi 终端 UI 库的终端应用插件 | `tui-startup`、`tui-app` |
| [`anago-core`](anago-core/README.zh.md) | 配置捆绑包：上述主机行 | （捆绑包） |
| [`anago-web`](anago-web/README.zh.md) | 配置捆绑包：上述浏览器行 | （捆绑包） |
| [`anago-tui`](anago-tui/README.zh.md) | 配置捆绑包：上述终端行 | （捆绑包） |

<a id="related-documentation"></a>
## 相关文档

- [项目指南](../../PROJECT_GUIDELINE.md) — denylist、守卫钩子与静态出站扫描。
- [启动包](../boot/app-boot/README.zh.md) — 导入该守卫的 profile 组合器。
- [同捆插件设计](../../ANAGO_PLUGINS_DESIGN.md) — 包划分、设置卡片与终端界面。

<a id="dev-note"></a>
## 开发备注

无。
