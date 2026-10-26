---
description: "日语优先的 Web UI 字体：UDEV Gothic 负责假名、汉字与全角形式，Intel One Mono 负责拉丁文字与代码，Noto Sans JP 作为覆盖更广的回退。"
kind: "package-reference"
---

# @anago-harness/client-ui-fonts-anago

[English](README.md) | 中文

## 概述

在 Web 配置中挂载本包，Anago 界面就会用日文字形绘制日文：UDEV Gothic 负责假名、汉字与全角形式，Intel One Mono 负责拉丁文字与代码，Noto Sans JP 覆盖其余字符。本包随附各字体的 woff2 文件及其 SIL OFL 许可证，覆盖 `--dsh-font-family-text-default` 与 `--dsh-font-family-code-default`，并在应用根节点设置正文字体栈，现有组件因此无需改动即可继承。在设置中保存的自定义字体仍排在最前。这些字体的 woff2 约占 5.3 MiB，进入客户端包后约 7 MiB。

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

在 Web 配置中挂载 `@anago-harness/anago-web`：它以 `anago-fonts` 插入本行，字体随其他浏览器行一同挂载。直接列出各行的组合可以自行加入同一条目：

```yaml
- insert:
    - id: anago-fonts
      name: '@anago-harness/client-ui-fonts-anago'
```

浏览器半随后挂载一份样式表，并在插件生命周期内保留它。不改动组件，也不新增设置项：这套字体就是界面默认的渲染方式。

| 字体族 | 文件 | 字重 | 绘制的字符 | 大小 |
|---|---|---|---|---|
| UDEV Gothic | `udev-gothic-regular.woff2` | 400 | 假名、CJK 表意文字、全角形式 | 1.7 MiB |
| Noto Sans JP | `noto-sans-jp-latin.woff2`、`noto-sans-jp-kana.woff2`、`noto-sans-jp-kanji.woff2` | 100–900 | 拉丁文字、假名、CJK 表意文字 | 3.6 MiB |
| Intel One Mono | `intel-one-mono-latin.woff2`、`intel-one-mono-latin-ext.woff2`、`intel-one-mono-symbols.woff2` | 300–700 | 拉丁文字、标点、制表符 | 41 KiB |

UDEV Gothic 是未经修改的上游字体，仅从 TTF 转换为 WOFF2，名字表与字形保持不变，因此随包字体族与指定字体一致。它的 `unicode-range` 不包含拉丁文字，因此正文中的拉丁字符落到 Noto Sans JP，代码中的拉丁字符落到 Intel One Mono；代码字体栈在上游的中文优先项之前列出了两个日文字体，代码片段因此不会回退到中文字形。用户在设置中保存的字体列表仍然排在最前，因为 `base.css` 在 `body` 上把该列表组合在被覆盖的默认值之前。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

Node 半是空的 `apply`，仅让本包持有一个 Loader 行，使客户端模块系统为该裸说明符提供 `./client` 产物。浏览器半导入 `src/styles/fonts.css?inline`，把其中的 `__DSH_FONT_*__` 占位符替换为导入的字体字节，并通过 `ctx.effect` 追加一个 `<style data-plugin="…">`；释放时该标签被移除。

字体字节以 data URL 形式到达，因为客户端包没有字体路由：Host 只为 `client.*.js` 分块提供 `/plugins/<package>/`，相对的 `url()` 会得到 404。`tsdown.config.ts` 增加一个插件，把 `*.woff2` 导入转成 `data:font/woff2;base64,…`，`src/client/font-assets.ts` 把每个文件映射到它的占位符。样式表采用注入而不是链接，原因相同：`apps/web` 只导入 ui-theme 的 `brand-font.css`，本包不修改该入口。

Token 覆盖使用 `:root:root`，因此无需依赖样式表顺序即可胜过 ui-theme 的 `:root` 默认值。样式表还在 `body` 与 `#root` 上设置 `font-family: var(--dsw-font-family)`，未声明字体族的组件因此继承正文栈；代码块保留 `--ds-font-family-code`，它解析到被覆盖的代码默认值。

字体的来源、字形数量、字宽与文件哈希记录在 `src/fonts/fonts.json`；许可证与文件同目录，为 `UDEV-Gothic-OFL.txt`、`Noto-Sans-JP-OFL.txt` 与 `Intel-One-Mono-OFL.txt`。Noto Sans JP 用 `pyftsubset --flavor=woff2` 按范围切分，Intel One Mono 原样随包。UDEV Gothic 保留上游名称与字形，仅容器由 TTF 变为 WOFF2，浏览器中的应用范围由 CSS `unicode-range` 限定。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [ui-theme](../../client/ui-theme/README.zh.md) — 拥有本包所覆盖的 token 默认值的包。
- [anago-web](../anago-web/README.zh.md) — 应当插入本行的浏览器 bundle。
- [fork 分组](../README.zh.md) — 本分组的包地图。
- [项目指南](../../../PROJECT_GUIDELINE.md) — 第 6.4 节规定了字体角色与终端检查。

-----

<a id="model-experience"></a>
## 模型体验

### 不参与模型上下文

#### 模型所见

无。本包只向浏览器文档注入 `@font-face` 规则与两个 CSS 自定义属性；它不注册提示词段落、工具、会话事件或任何模型可见文本。

#### Token 影响

无。字体文件与样式表从不进入模型请求；它们只改变浏览器绘制既有文本的方式。

#### KV Cache 影响

无。本包不添加请求前缀，也不改写请求字段，因此不会移动已缓存的前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 客户端包把每个字体以 base64 内联，因此 5.0 MiB 的 woff2 会让 `client.js` 增长到约 6.7 MiB；如果 Host 提供字体路由，浏览器就能按范围按需获取。
- UDEV Gothic 只随附 400 字重，因此加粗的日文渲染为合成粗体；Noto Sans JP 仅在它未覆盖的字符上提供真实字重。
- 本包仅属于本 fork，不发布到 npm。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

上游来源：GitHub release 中的 UDEV Gothic v2.2.0 `UDEVGothic-Regular.ttf`、`notofonts/noto-cjk` 的 Noto Sans JP 变量字体 `NotoSansJP-VF.ttf`，以及 `@fontsource-variable/intel-one-mono` 5.3.0 tarball 中的 Intel One Mono 变量 woff2 文件。UDEV 与 Noto 的文件按范围切分子集：假名与全角形式、CJK 表意文字，以及仅 Noto 包含的拉丁文字。Intel One Mono 原样随包。

重新生成时，用 fontTools 的 `pyftsubset` 配合记录范围内的 `--unicodes`、`--flavor=woff2` 与 `--drop-tables+=DSIG`，UDEV Gothic 则直接载入上游 TTF，设置 `flavor = 'woff2'` 后保存，不改动名字表；然后重新记录 `src/fonts/fonts.json` 中的字节数、哈希与字宽。测试会重算每个哈希，因此改动字体却不更新度量会导致测试失败。

测试刻意保持为文件级静态检查：它们读取样式表、许可证、清单与字体二进制，而不导入浏览器半，因此无需浏览器即可运行。`全角` 检查断言终端字体把全角字形的步进恰好推进为半角字形步进的两倍，这正是 xterm 测量的单元格比例。

</details>
