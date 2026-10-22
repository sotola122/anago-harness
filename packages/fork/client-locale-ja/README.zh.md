---
description: "anago Web UI 的日语语言包：注册 ja 语言，并为 49 个命名空间提供全键日语词典，覆盖对话界面、聊天记录、审批与提问、Agent 预设、工作区与会话列表、布局与侧栏控件、设置页面、模型页面与模型选择器、权限、斜杠命令、技能、后台任务、目标、定时任务、反馈、右侧栏面板、插件页面以及本 fork 的网页搜索卡片；缺失的键逐项回退到英语。"
kind: "package-reference"
---

# @anago-harness/client-locale-ja

[English](README.md) | 中文

## 概述

使用 `@anago-harness/client-locale-ja` 可以让 Web GUI 显示日语。浏览器半注册 `ja` 语言，并为 49 个命名空间（2032 个键）提供全键日语词典，覆盖对话界面、聊天记录、审批与提问、设置页面、模型页面、权限、命令、技能、后台任务、目标、定时任务、反馈、右侧栏、插件页面以及本 fork 的网页搜索卡片。注册通过 `ctx.effect` 完成，因此卸载插件会移除该语言和全部词典。本包未注册的命名空间或未翻译的键，会按语言服务的逐键回退链显示随包提供的英语文案，因此界面不会出现空标签。

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

在 Web 配置中把本包挂载为一行客户端插件。它没有配置项，也没有 Host 侧行为：激活后会在「设置 → 通用设置」中加入 **日本語**，并注册下面列出的词典。选择该语言后，语言偏好通过语言服务既有的设置路径写入。

- `conversation`（373 键）—— 对话界面：首屏、输入框占位符与提示、附件、工具行、详情面板、消息队列和终端卡片。
- `chat`（191 键）—— 聊天记录：步骤与回合状态、重试与失败提示、Token 统计、上下文与压缩行，以及聊天相关设置行。
- `approval`（5 键）与 `question`（31 键）—— 审批卡片与越权提示、提问卡片、计划审核操作和回复控件。
- `settings.agentPreset`（47 键）—— 标准、PTC、极简和创造模式的名称与说明、预设选择区和模式指南。
- `workspace`（119 键）—— 工作区选择器、会话行与分组、视图／排序／筛选控件、会话搜索、重命名与删除对话框，以及归档确认。
- `sidebar`（5 键）与 `shortcuts.layout`（1 键）—— 新建会话标签、侧栏开关、全局面板标签和布局命令标签。
- `common`（41 键）—— 共享界面词汇：按钮、对话框、复制控件和通用错误。
- `settings`（41 键）与 `settings.locale`（1 键）—— 设置外壳与通用设置页，包括「语言」行。
- `settings.shell`（14 键）—— 终端执行器的设置页。
- `settings.pluginInventory`（37 键）与 `pluginManager`（220 键）—— 插件页面的插件列表标签页、插件行和安装对话框。
- `settings.webSearchProviders`（35 键）—— 本 fork 的 Exa 与 Brave 网页搜索卡片。
- `settings.models`（134 键）与 `model`（23 键）—— 模型页面：提供商卡片与编辑器、API 密钥和基础 URL 字段、模型与推理级别编辑、欢迎与引导提示，以及模型与推理级别选择器。
- `permission.access`（12 键）与 `settings.permission`（12 键）—— 默认权限行及其完全访问确认，以及设置卡片。
- `command`（28 键）—— 斜杠命令菜单，包括命令名称、说明、搜索和空状态。
- `skill`（8 键）、`job`（40 键）与 `goal`（12 键）—— 技能加载行、后台任务名册与记录面板，以及目标栏。
- `schedule.catalog`（70 键）与 `schedule.manager`（188 键）—— 提醒目录、自动化任务列表与详情视图、投递记录、时间与 Cron 编辑器，以及删除确认。
- `feedback`（20 键）—— 回复评价操作，以及包含分类和错误的反馈对话框。
- `settings.theme`（25 键）、`settings.plugins`（5 键）、`settings.agentLoop`（12 键）、`settings.subagent`（35 键）与 `session-log-deepseek`（4 键）—— 外观与字体行、内置插件区，以及 Agent 循环、子代理和会话日志上传页面。
- `reference`（15 键）、`secretMask`（2 键）、`workflowRun`（18 键）、`plan`（17 键）、`slash.menu`（9 键）、`deepseek-model-label-1017`（1 键）与 `directory-browser`（13 键）—— `@` 引用菜单、凭据显示控件、工作流生命周期卡片、计划标签与预览、触发菜单、模型徽标，以及工作区目录选择对话框。
- `sidebarRight`（34 键）、`sidebarTerminal`（28 键）、`sidebarFiles`（17 键）、`sidebarDocumentPreview`（22 键）、`sidebarCodePreview`（3 键）、`sidebarExcel`（15 键）、`documentHtml`（4 键）、`sidebarImage`（11 键）、`documentMarkdown`（4 键）、`sidebarOffice`（15 键）与 `sidebarPdf`（15 键）—— 右侧栏停靠区、终端标签页、工作区文件树，以及带各格式渲染器的文档标签页。

本包未翻译的键会逐项回退到英语；未注册的命名空间则完全保留英语词典。因此部分覆盖不会留下空标签。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

Node 半是空的 `apply`，仅让本包持有一个 Loader 行，使客户端模块系统为该裸说明符提供 `./client` 产物。浏览器半声明 `inject = ['locale']`，并在 `ctx.effect` 中注册语言与各个命名空间，因此卸载时会移除 `ja` 定义和全部词典。词典是 `src/client/` 下扁平的「键到模板」对象；`common` 按语言包的 `CommonKey` 联合类型校验，49 个命名空间中有 42 个对应其所属客户端包中的 `en` 词典。`tests/fixtures/english-keys.json` 记录了这些英语键集合，当某个已镜像的命名空间新增、改名或删除键时，应用测试会失败。查找仍由语言服务负责：它先在请求的命名空间中按 `ja`、`en` 逐键查找，再在 `common` 中重复该链。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [客户端语言服务](../../client/locale/README.zh.md) —— 本包实现的注册表、回退链与语言包契约。
- [对话界面](../../client/ui-conversation/README.zh.md) —— 本包 `conversation` 文案所翻译的首屏、输入框和对话区域。
- [聊天记录](../../client/ui-chat/README.zh.md) —— 本包翻译的消息状态、重试与统计文案。
- [Agent 预设](../../client/ui-agent-preset/README.zh.md) —— 本包翻译的标准模式与创造模式选择器。
- [工作区选择器](../../client/ui-workspace/README.zh.md) —— 本包 `workspace` 文案所翻译的工作区与会话列表。
- [插件页面](../../client/ui-plugin-manager/README.zh.md) —— 本包的 `pluginManager` 文案所翻译的管理界面。
- [网页搜索卡片](../client-ui-settings-web-search/README.zh.md) —— 本包 `settings.webSearchProviders` 命名空间所翻译的 fork 卡片。

-----

<a id="model-experience"></a>
## 模型体验

### 仅浏览器的语言词典

#### 模型看到什么

无；`ja` 词典只进入浏览器渲染路径，不添加提示词段落、工具定义或工具结果。

#### Token 影响

无；没有任何译文进入模型请求或会话事件。

#### KV Cache 影响

无；本包不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **部分翻译并回退到英语。** 有七个命名空间只注册英语：`settings.account`（账号页面与模型页面的登录对话框）、`shortcuts`、`subagent`、`deliverables`、`open-in-app`、`pluginMarket` 与 `trajectory`；`sidebarBrowser` 保持英语，因为 Web 配置不挂载它。`pluginManager.installGuideIdExample` 有意省略，因为该包名在两种语言中读法相同。本包省略的其他键会通过语言服务的逐键回退链显示随包提供的英语文案，直到后续补齐。
- **没有服务端渲染文本。** 本包只注册浏览器端词典；不翻译服务端返回的 HTML、`<title>`，也不翻译客户端挂载前生成的任何文本。
- **仅覆盖 UI。** 工具结果、提示词、CLI 输出等模型可见文本不翻译；本包改变的是 Web GUI 呈现产品文案的方式，而不是模型收到的内容。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

本包位于 `packages/client/*` 之外，客户端包校验器不会检查它；其应用测试维持语言注册、词典查找、英语回退、卸载行为以及与英语的键一致性。`common` 词典在编译期按 `CommonKey` 校验；功能词典是普通对象，因为所属客户端包没有声明为运行时依赖。新增命名空间时，在 `src/client/index.ts` 中导入其词典并追加到 `DICTIONARIES`，再把对应英语键记录到 `tests/fixtures/english-keys.json`。
</details>
