---
description: "dsh Web 客户端插件页上的子智能体设置页：subagent 命名空间的委派深度与并行容量，以及 subagent-model-selection 里的模型授权和用途路由，同一页一次保存。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-subagent

[English](README.md) | 中文

## 概述

在侧栏打开**插件**，在官方分组里选择**子智能体**，即可设置委派可以多深、多宽，Agent 可以为子智能体选择哪些模型，以及每种用途使用哪个模型。页面把 Host 的两个命名空间 `subagent` 与 `subagent-model-selection` 收在一次保存之下；用途路由是后者的一个字段。Host 服务其中任一命名空间时页面就存在，并只显示被服务的部分。

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

**运行限制**把**最大递归深度**和**子智能体并行数量上限**并排放置，窄屏时上下堆叠；每个标签旁的信息按钮展开它的规则——深度是一张两行示例表，容量是计数口径——填了不在范围内的整数会阻止保存并在字段下说明。深度让位于工具自己的上限；容量统计同一主 Agent 下所有层级存活的子智能体，主 Agent 不计入。

**模型选择**把权限开关和精确的适配器路由一起暂存。开启时至少要选一条路由；关闭会保留已选路由以备后用。Host 已存储但没有适配器公布的路由留在**已保存但当前不可用**分组里并且仍可移除；加载失败的提供方会被报告而不隐藏其他提供方，加载失败时提供**重试**。

**用途路由**列出轻量、标准、深入、审阅、写作和默认。每一行从同一目录里选择提供方、模型和推理强度。审阅可以添加、移除和调整审阅者的顺序，且不能少于一名；其他用途各有一条路由。目录不再公布的路由仍显示为已保存但当前不可用，并且仍可保存。缺少字段、重复的审阅路由，或所选模型不提供的推理强度，都会阻止保存。没有路由表的部署会说明这一点，并且不提供创建入口。保存后的表在下次委派时生效；模型授权仍只作用于新组成的会话。

一次**保存**写入运行限制命名空间和模型选择命名空间，每次写入都以其草稿读取时的修订号作栅栏。用途路由与模型选择共用这一次写入并排在其后，因此同一表单里另一个字段的变更不会使另一份草稿失效。Host 拒绝的部分保留草稿并报告失败，另一个命名空间照常落地；被更新的 Host 修订号超越的草稿会以冲突形式报告并要求放弃，而不是覆盖较新的值。离开页面即丢弃所有草稿。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

宿主半侧是一个空的 `apply`，只为让本包占一条 Loader 行，客户端模块系统据此送出浏览器半侧。浏览器半侧通过 `ctx.configForms.get` 分别绑定两个命名空间：`SubagentLimitsCardController` 用 `ui-primitives` 的共享 `SettingsFormModel` 暂存运行限制，字段规格只接受不低于各自下限的安全整数；`SubagentModelSelectionCardController` 自己维护草稿，因为它的两个字段要作为一次带修订栅栏的 `mutate` 保存，它把已存储的路由与 `remote.session.modelCatalog()` 合并，在 `llm/adapters-updated` 与 `settings/document-updated` 时重读目录，连接重置时丢弃草稿。`SubagentPurposeRoutesCardController` 在同一表单上暂存 `purposeRoutes`，并把整张表作为一次带修订栅栏的 `mutate` 写入；修订号变化但表本身未变时，它推进自己的栅栏。`subagentCardFace` 把三者合成 `SubagentCard` 在共享 `SettingsForm` 里渲染的一个 face，保存时校验每一部分并写入有改动的那些，用途路由的写入排在同一次修订上的模型选择写入之后。页面通过 `ctx.configForms.whileServed` 监视两个命名空间，注册进插件页的 `plugins.item` slot。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [ui-plugin-manager](../ui-plugin-manager/README.zh.md)——插件页以及本页注册进去的 `plugins.item` slot。
- [ui-settings](../ui-settings/README.zh.md)——本页依赖的设置 scope 与"命名空间被服务期间"的监视。
- [ui-primitives](../ui-primitives/README.zh.md)——运行限制部分渲染的设置表单模型与字段。
- [tool-subagent](../../subagent/tool-subagent/README.zh.md)——注册这两个命名空间的委派工具。

-----

<a id="model-experience"></a>
## 模型体验

无，本包是浏览器侧的设置界面，不注册任何模型面。

#### KV 缓存影响

无；本包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **目录只在三种信号下重读**——适配器变化、文档提交和重连；在这三者之外开始公布模型的提供方，要等下一次信号或点击**重试**才会出现。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
