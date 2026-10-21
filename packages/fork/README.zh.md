---
description: "Anago Harness 的 fork 自有策略包。"
kind: "package-group"
---

# fork/：fork 策略

[English](README.md) | 中文

## 概述

fork 组保存本 fork 的私有策略。`fork-policy` 安装 Node 出站守卫，以及启动组合器读取的 profile patch 列表。包 README 负责 denylist 与守卫行为。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

<a id="packages"></a>
## 包

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`fork-policy`](fork-policy/README.zh.md) | Node 出站守卫与 fork profile patch 列表 | （由 app boot 导入的库） |

<a id="related-documentation"></a>
## 相关文档

- [项目指南](../../PROJECT_GUIDELINE.md) — denylist、守卫钩子与静态出站扫描。
- [启动包](../boot/app-boot/README.zh.md) — 导入该守卫的 profile 组合器。

<a id="dev-note"></a>
## 开发备注

无。
