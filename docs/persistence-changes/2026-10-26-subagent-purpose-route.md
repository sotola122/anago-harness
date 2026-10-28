---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-26-subagent-purpose-route

English | [中文](2026-10-26-subagent-purpose-route.zh.md)

## Summary

`@deepseek-ai/dsh-tool-subagent` appends a log-only `subagent/purpose-route` event when a purpose-routed child outcome is committed. The payload carries the tool-call id, the selected table slot, the provider, model, and reasoning effort, and whether that child started.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

Writers set `ignorable: true`. An older reader skips an unknown ignorable envelope and does not interpret the payload. The event is log-only: it has no surface operation and does not enter model history. Existing events are unchanged, so the Session format version stays at V4.

<a id="verification"></a>
## Verification

`vitest run packages/subagent/tool-subagent/tests/purpose-routing.spec.ts` passed 16 tests. `tsx scripts/persistence-changes.ts --check` accepts the acknowledgement after this record is written.

<a id="dev-note"></a>
## Dev Note

None.
