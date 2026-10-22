# Fork 说明

[English](fork.md) | 中文

## 本仓库是什么

Anago Harness 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的非官方 fork，后者是 [DeepSeek AI](https://deepseek.com) 开发的开源 agent harness。本 fork 保留上游架构与许可，与 DeepSeek AI 无隶属关系，也未获其背书，并在 [PROJECT_GUIDELINE.md](../PROJECT_GUIDELINE.md) 中记录设计基线。

## 保持与上游兼容的部分

包名（`@deepseek-ai/dsh-*`）、`dsh` 命令、`DSH_*` 环境变量与 `~/.dsh` 主目录沿用上游名称，因此上游插件、配置、配置文件与文档引用继续可用。

## fork 改变了什么

`@anago-harness/fork-policy` 安装出站守卫，拒绝 harness 自行联系的主机；`api.deepseek.com` 保持可达。本仓库不运行上游的发布、预览、issue 与审批工作流。改动集中在 fork 私有文件与少量 hook 点，便于合并上游更新。

fork 以 `packages/fork/` 下的私有包提供自己的能力，并通过三个捆绑包挂载：`@anago-harness/anago-core`（记忆、LLM wiki、日语响应指令、Cursor 子代理，以及 Exa 与 Brave 搜索提供方）、`@anago-harness/anago-web`（Exa 与 Brave 搜索设置卡片）、`@anago-harness/anago-tui`（基于 pi 终端 UI 库的终端界面）。`web` 与 `headless` 配置模板选择核心捆绑包，`web` 还选择浏览器捆绑包，新增的 `tui` 模板选择核心与终端捆绑包。

## 接下来

[PROJECT_GUIDELINE.md](../PROJECT_GUIDELINE.md) 规划剩余的 fork 工作：产品品牌、日语字体、`ash` 命令与桌面安装包。[ANAGO_PLUGINS_DESIGN.md](../ANAGO_PLUGINS_DESIGN.md) 记录包划分与设置卡片设计。

## 文档与许可

[上游文档](https://deepseek-harness.github.io/deepseek-harness/) 仍是代码的参考。本 fork 依上游 MIT 许可分发；见 [LICENSE](../LICENSE) 与 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。
