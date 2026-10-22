---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-22-memory-review-request

[English](2026-10-22-memory-review-request.md) | 中文

## 概述

`@anago-harness/memory` 把每次轮末审查的模型请求记录为仅日志的 `memory/review-request` 会话事件。负载包含解析后的路由、确切的系统文本、确切的消息数组、token 上限以及解析后的推理强度，因此该辅助请求可以像对话请求一样从会话日志中重建。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-22-memory-review-request
baseline: false
changes:
  - root: "event:memory/review-request"
    previous: null
    after: "1dfccbc61a68d86f1e22ea2cbc3af8a070277dcbfa65ee9e99e5e934d9b7d754"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

这新增了一个事件根。不认识该事件的旧读取方会将其视为不透明记录并在重写时保留，这正是同一格式版本内新增未知事件的既有契约；恢复、压缩或导出会话都不会解释它。对话路径未改变，且该事件仅用于日志（无界面、无重放效果）。因此 Session 格式版本保持 V4。

<a id="verification"></a>
## 验证

`tsx scripts/persistence-changes.ts --check` 报告已确认的历史。memory 测试断言该事件在流开始前存在且携带确切请求，`vitest run packages/fork/memory/tests` 通过 11 个文件、239 个测试。

<a id="dev-note"></a>
## 开发备注

无。
