---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-21-anago-message-sources

English | [中文](2026-10-21-anago-message-sources.zh.md)

## Summary

The fork's memory and LLM wiki plugins inject model-visible context as user messages and declare their own `user/message.data.source` kinds: `memory` and `memory-review` from `@anago-harness/memory`, and `llm-wiki` from `@anago-harness/llm-wiki`. Before this change the union had no such variants.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

Each new kind is an additional discriminator on an optional message source, not a change to an existing one. The message content and its role in the request are unchanged for every current kind. A reader that does not know a kind keeps the record opaque and preserves it on rewrite, which is the behaviour the existing reader contract requires for unknown optional features; nothing requires interpretation of these values to resume, compact, or export a Session. The Session format version therefore stays at V4, and the new kinds remain ignorable additions.

<a id="verification"></a>
## Verification

`tsx scripts/persistence-changes.ts --check` reports the acknowledged history. The unit suites for both packages assert the declared `MessageSourceMap` kinds and the injected message payloads, and `vitest run packages/fork` passes 49 files and 1003 tests. Replay of the recorded headless scenario `bash-tool-turn` (with the fork compatibility patch) stays byte-identical, which shows existing recordings are unaffected.

<a id="dev-note"></a>
## Dev Note

None.
