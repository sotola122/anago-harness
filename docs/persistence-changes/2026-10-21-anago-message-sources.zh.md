---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-21-anago-message-sources

[English](2026-10-21-anago-message-sources.md) | 中文

## 概述

本 fork 的记忆与 LLM wiki 插件以用户消息注入模型可见上下文，并声明各自的 `user/message.data.source` kind：`@anago-harness/memory` 的 `memory` 与 `memory-review`，以及 `@anago-harness/llm-wiki` 的 `llm-wiki`。此前该联合类型没有这些变体。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-21-anago-message-sources
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-13-user-rpc-principal"
    after: "7935013984ac1e3f6a665b55494efd8d1f189d5dfee83ef72d0f4d184ba9af37"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-13-user-rpc-principal"
    after: "6a763b551221e5406c146d8dc155db0ba64073260bed79faaedbdc6b0d1267d8"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-13-user-rpc-principal"
    after: "9aa4f76f6526fc76ad0042e6a7aadf84b99d7a09302dc15f6082358c1b3e4723"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-13-user-rpc-principal"
    after: "2068c495115b263f836c72bb0c14fc63ec216c67dbfb759b16aa59e818161824"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

每个新 kind 都是消息来源上的额外判别值，而不是对既有变体的修改；`source` 字段本身是必需的，可忽略的部分是未知生产者判别值。所有现有 kind 的消息内容及其在请求中的角色均未改变。不识别某个 kind 的读取方会将该记录视为不透明并在重写时保留，这正是读取方契约对未知可选特性的要求；恢复、压缩或导出会话都不需要解释这些值。因此 Session 格式版本保持 V4，新 kind 属于可忽略的增量。

<a id="verification"></a>
## 验证

`tsx scripts/persistence-changes.ts --check` 报告已确认的历史。两个包的单测断言了声明的 `MessageSourceMap` kind 与注入的消息负载，`vitest run packages/fork` 通过 49 个文件、1003 个测试。使用 fork 兼容 patch 重放已录制的 headless 场景 `bash-tool-turn` 结果字节一致，说明既有录制不受影响。

<a id="dev-note"></a>
## 开发备注

无。
