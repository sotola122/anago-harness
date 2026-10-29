---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-29-anago-message-sources-after-sync

English | [中文](2026-10-29-anago-message-sources-after-sync.zh.md)

## Summary

Re-acknowledges the fork message-source kinds memory, memory-review, and llm-wiki at the upstream tail, including the message unions on memory/review-request and session/title-llm-request.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

Existing records that omit these kinds remain readable, and absence keeps the previous behavior. The kinds are additional source discriminators, not changes to an existing kind. A reader that does not know a kind keeps the record opaque and preserves it on rewrite; resume, compaction, and export do not require interpreting it. memory/review-request stays a log-only event. The Session format version stays at V4.

<a id="verification"></a>
## Verification

pnpm run verify-persistence-changes is the acceptance check for this acknowledgement. The source-kind and review-request behavior checks remain the ones recorded in 2026-10-21-anago-message-sources and 2026-10-22-memory-review-request. This record adds no runtime behavior.

<a id="dev-note"></a>
## Dev Note

The upstream sync moved the tail past the fork's earlier acknowledgement, so this record re-acknowledges the merged union at the new tail.
