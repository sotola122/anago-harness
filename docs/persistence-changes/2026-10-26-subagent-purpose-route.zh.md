---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-26-subagent-purpose-route

[English](2026-10-26-subagent-purpose-route.md) | 中文

## 概述

`@deepseek-ai/dsh-tool-subagent` 在用途路由的子级结果提交时追加仅日志的 `subagent/purpose-route` 事件。负载包含工具调用 id、所选表行、提供方、模型、推理强度，以及该子级是否已启动。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-26-subagent-purpose-route
baseline: false
changes:
  - root: "event:subagent/purpose-route"
    previous: null
    after: "26495f85055b1d5c86cf81ea3002a2989d02469bea830f8537c2364e124e0386"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

写入方设置 `ignorable: true`。旧读取方跳过未知的 ignorable 信封，不解释其负载。该事件仅用于日志：没有界面操作，也不进入模型历史。既有事件不变，因此 Session 格式版本保持 V4。

<a id="verification"></a>
## 验证

`vitest run packages/subagent/tool-subagent/tests/purpose-routing.spec.ts` 通过 16 个测试。写入本记录后，`tsx scripts/persistence-changes.ts --check` 接受该确认。

<a id="dev-note"></a>
## 开发备注

无。
