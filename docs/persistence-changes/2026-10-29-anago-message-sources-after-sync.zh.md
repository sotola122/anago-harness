---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-29-anago-message-sources-after-sync

[English](2026-10-29-anago-message-sources-after-sync.md) | 中文

## 概述

在上游链尾重新确认 fork 的消息来源 kind memory、memory-review 与 llm-wiki，包括 memory/review-request 与 session/title-llm-request 上的消息联合类型。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-29-anago-message-sources-after-sync
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    after: "4fd57afe8822bd50371b80485dd52203d8b627f0f23f7b491bfc957e40dd320c"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    after: "60b5a8338f0b3764aaf986b1248594f4a62321d789c9c68427715b89985b9310"
    decision: same-version
  - root: "event:memory/review-request"
    previous: "2026-10-22-memory-review-request"
    after: "613f9202ce01971d65990a1b093efef692789b1a6564199f3a8c3837b9bb10cb"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    after: "236cb7414ad1e58a88e3e02e8fd8db6d238cf0f52c0066ed0436cfaffa7d6a36"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    after: "26ac7b10519cc4a437042785fb82b30782a77e64ef6676cac44a405a4424d51f"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

省略这些 kind 的已有记录仍然可读，缺失时保持原先行为。这些 kind 是来源上的额外判别值，不是对既有 kind 的修改。不识别某个 kind 的读取方会将该记录视为不透明并在重写时保留；恢复、压缩和导出都不需要解释它。memory/review-request 仍是仅日志事件。Session 格式版本保持 V4。

<a id="verification"></a>
## 验证

pnpm run verify-persistence-changes 是本确认的接受检查。来源 kind 与 review-request 的行为检查仍以 2026-10-21-anago-message-sources 和 2026-10-22-memory-review-request 所记录的为准。本记录不增加运行时行为。

<a id="dev-note"></a>
## 开发备注

上游同步把链的末端移到了 fork 原先的确认之后，因此本记录在新的末端重新确认合并后的联合类型。
