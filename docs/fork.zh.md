# Fork 说明

[English](fork.md) | 中文

## 本仓库是什么

Anago Harness 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的非官方 fork。DeepSeek Harness 是由 [DeepSeek AI](https://deepseek.com) 开发的开源 agent harness（智能体框架）。本 fork 保留上游架构与许可证，与 DeepSeek AI 没有隶属关系，也未获其背书；设计基线见 [PROJECT_GUIDELINE.md](../PROJECT_GUIDELINE.md)。

## 保持上游兼容的部分

包名（`@deepseek-ai/dsh-*`）、`dsh` 命令、`DSH_*` 环境变量和 `~/.dsh` 主目录沿用上游名称，上游插件、profile、配置和文档引用继续可用。

## 本 fork 变更的部分

`@anago-harness/fork-policy` 安装出站守卫，拒绝 harness 自行发起的、指向 denylist 主机的连接；`api.deepseek.com` 保持可达。本仓库不运行上游的发布、预览、Issue 与审批工作流。变更仅限 fork 专有文件和少量 hook 点，以便上游更新继续合并。

## 后续工作

[PROJECT_GUIDELINE.md](../PROJECT_GUIDELINE.md) 规划剩余工作：产品品牌、日文字体、`ash` 命令、默认使用 Exa 搜索，以及桌面安装包。

## 文档与许可证

代码的权威文档仍是[上游文档](https://deepseek-harness.github.io/deepseek-harness/)。本 fork 按上游 MIT 许可证分发，见 [LICENSE](../LICENSE) 与 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。
