---
description: "Exa search provider that resolves its key through the credentials service."
kind: "package-reference"
---

# @anago-harness/web-search-exa

[English](README.md) | 中文

## 概述

`@anago-harness/web-search-exa` 向 `ctx.web` 注册一个 id 为 `exa` 的 Exa 搜索提供方。它是对 `@deepseek-ai/dsh-web-search-exa` 导出的上游 `ExaSearchProvider` 的薄封装：封装层在每次搜索时解析 API 密钥，并把 HTTP 请求和响应映射委托给新建的上游实例。上游失败在离开封装层之前会被重写，因此消息只指出提供方与凭据引用名，并携带已替换密钥、已限长的细节。

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

加入该行，并在 `web` 行中选择提供方：

```yaml
- id: web-search-exa
  name: '@anago-harness/web-search-exa'
  config:
    apiKeyEnv: EXA_API_KEY
- id: web
  name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: exa
    fetchProvider: http
```

不要同时加载上游的 `@deepseek-ai/dsh-web-search-exa` 插件。两者都注册 id `exa`，`ctx.web` 会拒绝重复 id。

### 密钥解析顺序

每次搜索按以下顺序解析密钥：

1. 非空的配置 `apiKey`。
2. 当 `apiKeyEnv` 是合法引用名且 credentials 服务存在时，调用 `ctx.credentials.resolve(credentialRef(apiKeyEnv))`。
3. 启动环境中的 `launchEnvironmentOf(ctx).get(apiKeyEnv)`。

三者都没有提供密钥时，搜索以 `WEB_PROVIDER_CREDENTIAL_MISSING` 失败，报文只指出引用名。提供方不会在错误报文中记录、回显或嵌入已解析的密钥。

`available()` 返回 `URL.canParse(baseURL)`，不要求密钥。credentials 服务是异步的，无法在同步的提供方选择路径中读取；若在那里要求本地可见密钥，只存在于 credentials 中的密钥就会变得不可用。缺少密钥改在搜索时暴露。

### 配置

所有字段都是 `Volatile`，配置变更会作用到下一次搜索。`apiKey` 带 `role: secret`；`apiKeyEnv` 带 `role: credential-ref`。

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `apiKey` | （未设置） | 直写的 Exa API 密钥；推荐使用 `apiKeyEnv`，避免密钥进入配置文件。 |
| `apiKeyEnv` | `EXA_API_KEY` | 凭据引用名；credentials 服务和启动环境都使用该名称。 |
| `baseURL` | `https://api.exa.ai` | 端点基础 URL；会追加 `/search`。无法解析时 `available()` 为 false。 |
| `searchType` | `auto` | 作为 Exa `type` 发送的检索模式：`auto`、`keyword` 或 `neural`。 |
| `numResults` | （未设置） | 请求未带 `maxResults` 时的默认结果数；必须是正整数。 |
| `highlightsPerResult` | `1` | 每个结果请求的 highlight 句数（Exa 的 `highlightsPerUrl`）；必须是正整数。 |

请求的 `maxResults` 优先于配置的 `numResults`，并作为成本和延迟优化发送给 Exa；最终上限由 web 服务执行并设置 `truncated`。

### 错误代码

| 情况 | 代码 | 报文方针 |
| --- | --- | --- |
| 所有来源都没有密钥 | `WEB_PROVIDER_CREDENTIAL_MISSING` | 只指出引用名和三个可存放密钥的位置；绝不包含值。 |
| credentials 服务失败 | `WEB_PROVIDER_ERROR` | 指出引用名，并在 `cause` 中携带解析失败原因。 |
| 查询超过 `2000` 字符 | `WEB_PROVIDER_ERROR` | 报告长度和上限；不回显查询。 |
| 空查询 | `WEB_PROVIDER_ERROR` | 要求提供非空查询。 |
| Exa 返回 HTTP 错误 | `WEB_PROVIDER_ERROR` | 指出 `Exa search`、引用名，以及最多 200 字符、已用本次密钥替换的上游细节。 |
| 传输失败或正文不可解析 | `WEB_PROVIDER_ERROR` | 同样的重写形式，并在 `cause` 中保留上游失败。 |
| 调用方取消 | `WEB_ABORTED` | 不含额外细节。 |

封装层从不原样透传上游消息。`src/provider.ts` 的 `upstreamFailure` 对上游消息调用 `@anago-harness/web-search-credentials` 的 `redactSecret` 与 `boundedProviderDetail`：代理、网关或提供方回显的密钥或其 base64 编码会变为 `[REDACTED]`，细节截到 200 字符。若约简后没有可打印内容，消息只陈述失败类别。取消仍为 `WEB_ABORTED`；其他失败保留上游错误码，`cause` 保留上游错误供日志使用。

-----

<a id="understand-the-implementation"></a>
## 理解实现

上游插件只在构建提供方时读取一次 `config.apiKey ?? launchEnvironmentOf(ctx).get('EXA_API_KEY')`。它完全不读 `ctx.credentials`，因此从设置界面保存的密钥对它不可见；只存在于 credentials 中的密钥还会让上游提供方在选择阶段就不可用。本 fork 包补上这一缺口：优先通过 credentials 服务解析，在没有本地可见密钥时仍保持提供方可选，并在每次搜索时重新解析密钥，密钥更换无需重启。

`anago-core` 捆绑包持有该行并选择 `exa` 作为搜索提供方；本包不附带 `cordis.patch.yml`。

| 文件 | 作用 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | 插件入口：`Volatile` 配置 schema、通过 `ctx.effect` 注册提供方，以及每次搜索的选项投影。 |
| [`src/provider.ts`](src/provider.ts) | `ExaCredentialSearchProvider`：`available()`、每次搜索的密钥解析、查询上限、委托给上游类，以及失败重写。 |
| [`tests/index.spec.ts`](tests/index.spec.ts) | 通过 `globalThis.fetch` 注入 `fetch` 的单元套件。 |

`search()` 先检查取消和查询上限，只快照一次配置，解析密钥，然后为本次搜索构造且仅构造一个 `new ExaSearchProvider({ apiKey, baseURL, searchType, numResults, highlightsPerResult })`。搜索之间不保留任何状态。因此并发搜索不会共享密钥或选项快照，每次都会得到自己的上游实例。封装层不调用上游的 `available()`；上游 `search()` 会校验收到的值并映射自己的失败。

`upstreamFailure` 读取上游 `code` 而不要求它是 harness 类，保留 `WEB_ABORTED`（名为 `AbortError` 的拒绝也一样），未知代码回落为 `WEB_PROVIDER_ERROR`。消息由提供方名、引用名、错误码与已替换、已限长的细节构成，绝不取自原始正文或密钥。

上游类直接使用 `globalThis.fetch`，因此测试在该全局上安装 fake，并在每个用例后恢复。

-----

<a id="further-exploration"></a>
## 进一步探索

- [fork 分组](../README.zh.md) — 本分组的包地图。
- [上游 Exa 提供方](../../web/web-search-exa/README.zh.md) — 本封装委托的请求/响应映射。
- [web 服务](../../web/web/README.zh.md) — 提供方选择与 `WebError` 分类。
- [tool-web](../../web/tool-web/README.zh.md) — 渲染这些 source 的模型可见 `web_search` 工具。

-----

<a id="model-experience"></a>
## 模型体验

间接通过 `@deepseek-ai/dsh-tool-web` 体现：模型看到上游提供方按 `maxResults` 限制的 URL、标题、第一个非空 highlight 和发布日期，或者在工具的错误包装下看到封装层的 `WebError` 文本——`Exa search failed for "<reference>" (<code>): <redacted detail>` 或 `Exa search aborted`。上游消息、密钥或原始正文都不会到达模型。没有非空 highlight 的结果会被丢弃，因此一次调用可能返回少于请求数的 source。

#### KV Cache 影响

提供方自身不增加请求前缀；缓存影响由搜索工具拥有，结果集变化只改变追加的工具结果。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **查询校验由封装层负责。** 上游 `ExaSearchProvider` 不校验查询。本封装以 `WEB_PROVIDER_ERROR` 拒绝空查询和超过 `2000` 字符（Exa 文档字段上限）的查询；该上限是常量，不是配置字段。
- **没有生成式答案。** Exa 只返回 source，因此 `content` 永远不会被设置。
- **source 必须有 highlight。** 没有非空 highlight 的结果会被丢弃，而不是编造摘要。
- **只暴露很窄的 Exa 表面。** `livecrawl`、category、域名/日期过滤和全文 contents 不可用，因为 seam 没有对应的提供方中立字段。
- **中止分类依据名称。** 错误码为 `WEB_ABORTED` 或 `name` 为 `AbortError` 的失败映射为 `WEB_ABORTED`；其他形状的中止表现为 `WEB_PROVIDER_ERROR`。
- **拒绝重复 id。** 不要与上游 `@deepseek-ai/dsh-web-search-exa` 插件同时挂载本包。
- **没有包自有的显示元数据或设置卡片。** 行由捆绑包持有，密钥表单由独立设置卡片持有。
- **本套件没有真实密钥的端到端运行。** 测试使用注入的 `fetch`，不打开套接字。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

封装层有意不把 `available()` 委托给上游类：上游 `available()` 要求非空密钥，这会让只存在于 credentials 的密钥在异步解析器运行前就选择失败。上游类在每次搜索时构造一次，因此并发调用不会共享选项。`EXA_QUERY_MAX_CHARS` 定义在 `src/provider.ts`；上游类及其 wire 类型未修改。上游失败会被重写而不是原样透传：模型可见的消息归封装层所有，上游失败保留在 `cause` 中。
</details>
