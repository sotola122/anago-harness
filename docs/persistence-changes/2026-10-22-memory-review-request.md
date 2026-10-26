---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-22-memory-review-request

English | [中文](2026-10-22-memory-review-request.zh.md)

## Summary

`@anago-harness/memory` records each turn-end review model request as a log-only `memory/review-request` session event. The payload carries the resolved route, the exact system text, the exact messages array, the token cap, and the resolved reasoning effort, so the auxiliary request is reconstructable from the session log exactly like the conversation request.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

This adds a new event root. Older readers that do not know the event keep the record opaque and preserve it on rewrite, which is the existing contract for unknown required events added within the same format version; nothing resumes, compacts, or exports a Session by interpreting it. The conversation path is unchanged, and the event is log-only (no surface, no replay effect). The Session format version therefore stays at V4.

<a id="verification"></a>
## Verification

`tsx scripts/persistence-changes.ts --check` reports the acknowledged history. The memory suite asserts that the event exists before the stream starts and carries the exact request, and `vitest run packages/fork/memory/tests` passes 11 files and 239 tests.

<a id="dev-note"></a>
## Dev Note

None.
