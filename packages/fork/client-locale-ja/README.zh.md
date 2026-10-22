---
description: "anago Web UI 的日语语言包：注册 ja 语言与部分日语词典，覆盖共享界面词汇、设置与插件页面，以及本 fork 的网页搜索卡片；缺失的键逐项回退到英语。"
kind: "package-reference"
---

# @anago-harness/client-locale-ja

[English](README.md) | 中文

## 概述

使用 `@anago-harness/client-locale-ja` 可以为 Web GUI 的语言选择器添加 日本語。浏览器半注册 `ja` 语言，以及共享界面词汇、设置外壳与通用设置页、插件页面，还有本 fork 的 Exa 与 Brave 搜索卡片的日语词典。注册通过 `ctx.effect` 完成，因此卸载插件会移除该语言和全部词典。翻译有意保持部分覆盖：本包未注册的命名空间或未翻译的键，会按语言服务的逐键回退链显示随包提供的英语文案，因此在覆盖率提升过程中界面不会出现空标签。

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

- `common` —— 共享界面词汇：按钮、对话框、复制控件和通用错误。
- `settings` —— 设置外壳与通用设置页，包括「语言」行。
- `settings.shell` —— 终端执行器的设置页。
- `settings.pluginInventory` 与 `pluginManager` —— 插件页面的插件列表标签页、插件行和安装对话框。
- `settings.webSearchProviders` —— 本 fork 的 Exa 与 Brave 网页搜索卡片。

本包未翻译的键会逐项回退到英语；未注册的命名空间则完全保留英语词典。因此部分覆盖不会留下空标签。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

Node 半是空的 `apply`，仅让本包持有一个 Loader 行，使客户端模块系统为该裸说明符提供 `./client` 产物。浏览器半声明 `inject = ['locale']`，并在 `ctx.effect` 中注册语言与各个命名空间，因此卸载时会移除 `ja` 定义和全部词典。词典是 `src/client/` 下扁平的「键到模板」对象；`common` 按语言包的 `CommonKey` 联合类型校验，各功能命名空间则对应其所属客户端包中的 `en` 词典。查找仍由语言服务负责：它先在请求的命名空间中按 `ja`、`en` 逐键查找，再在 `common` 中重复该链。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [客户端语言服务](../../client/locale/README.zh.md) —— 本包实现的注册表、回退链与语言包契约。
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

- **部分翻译并回退到英语。** 只翻译上面列出的命名空间。其他命名空间以及本包省略的键，会通过语言服务的逐键回退链显示随包提供的英语文案，直到后续补齐。
- **没有服务端渲染文本。** 本包只注册浏览器端词典；不翻译服务端返回的 HTML、`<title>`，也不翻译客户端挂载前生成的任何文本。
- **仅覆盖 UI。** 工具结果、提示词、CLI 输出等模型可见文本不翻译；本包改变的是 Web GUI 呈现产品文案的方式，而不是模型收到的内容。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

本包位于 `packages/client/*` 之外，客户端包校验器不会检查它；其应用测试维持语言注册、词典查找、英语回退与卸载行为。`common` 词典在编译期按 `CommonKey` 校验；功能词典是普通对象，因为所属客户端包没有声明为运行时依赖。新增命名空间时，在 `src/client/index.ts` 中导入其词典并追加到 `DICTIONARIES`。
</details>
