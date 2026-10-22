---
description: "anago 配置的终端应用层：基于 pi 的 TUI 以及它回答的 ask-user 工具。"
kind: "package-bundle"
---

# @anago-harness/anago-tui

[English](README.md) | 中文

## 概述

anago 配置的终端应用层：基于 pi 的 TUI 以及它回答的 ask-user 工具。 本包不携带运行时代码，其实质是 `cordis.patch.yml`，由 manifest 的 `dsh.bundle.patch` 字段声明。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

只在终端配置中挂载。`tui` 配置模板会选择它；Web 配置不能选择，因为应用行会接管终端。

| 行 | 包 |
|---|---|
| `tui-startup` | `@anago-harness/tui`（startup 入口） |
| `tui-app` | `@anago-harness/tui` |
| `tool-ask-user` | `@deepseek-ai/dsh-tool-ask-user` |

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

配置组合器读取本捆绑包的 patch，在上游捆绑包层之后应用，然后再应用配置自身的 patch。非 insert 条目会整体替换目标行的 `config`。行仍可在 Plugins 页面切换；在 `cordis.patch.yml` 中用 `- id: <row>` 与 `disabled: true` 关闭某一行。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [fork 分组](../README.zh.md) — 本分组的包地图。
- [捆绑插件设计](../../../ANAGO_PLUGINS_DESIGN.md) — 包划分与设置卡片。

-----

<a id="model-experience"></a>
## 模型体验

间接：通过每个被插入的行所属的包，由它拥有该行的模型面向行为。

#### KV Cache 影响

捆绑包自身不增加请求前缀；各插入行所属的包拥有任何缓存影响。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 本捆绑包仅属于本 fork，不发布到 npm。
- 其行就是普通配置行；删除捆绑包会同时删除它挂载的全部能力。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。
</details>
