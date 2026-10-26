---
kind: upgrade-guide
description: "The shipped profiles no longer mount the subagent_cursor and subagent_pi tools."
---

# Cursor and Pi subagent tools are removed

English | [中文](guide.zh.md)

## Change

`@anago-harness/anago-core` no longer inserts `subagent-cursor`, `tool-subagent-cursor`, `subagent-pi`, or `tool-subagent-pi`. Profiles that mount that bundle, including `web` and `headless`, no longer expose `subagent_cursor` or `subagent_pi`.

`@anago-harness/subagent-cursor` and `@anago-harness/subagent-pi` are no longer in this repository. A profile patch that still names those row ids does not restore the tools; the loader reports `patch: entry "<id>" not found` and skips the patch.

A model, skill, or script that calls either tool receives `ToolNotFoundError` (`UNKNOWN_TOOL`), with the message `unknown tool "subagent_cursor"` or `unknown tool "subagent_pi"`. The other delegation tools are unchanged.

## Migration

1. Remove calls to `subagent_cursor` and `subagent_pi` from skills, prompts, and automations. Delegate with `subagent` or another tool the profile still mounts.
2. In the profile's `cordis.patch.yml` and in `$DSH_HOME/cordis.patch.yml`, delete entries whose `id` is `subagent-cursor`, `tool-subagent-cursor`, `subagent-pi`, or `tool-subagent-pi`, including `disabled: true` overrides.
3. If the profile `package.json` lists `@anago-harness/subagent-cursor` or `@anago-harness/subagent-pi`, remove those dependencies and reinstall.
4. Confirm with `dsh --profile headless --dump-config`: stderr has no `patch: entry "subagent-cursor" not found` (or the Pi ids), the four ids are absent from the tree, and a new Session's tool list has neither `subagent_cursor` nor `subagent_pi`.
