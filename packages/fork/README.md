---
description: "Fork-owned policy packages for Anago Harness."
kind: "package-group"
---

# fork/ — fork policy

English | [中文](README.zh.md)

## Summary

The fork group holds private policy for this fork. `fork-policy` installs the Node egress guard and the profile patch lists the boot composer reads. The package README owns the denylist and the guard behavior.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`fork-policy`](fork-policy/README.md) | Node egress guard and fork profile patch lists | (library imported by app boot) |

<a id="related-documentation"></a>
## Related documentation

- [Project guideline](../../PROJECT_GUIDELINE.md) — denylist, guard hook, and static egress scan.
- [Boot package](../boot/app-boot/README.md) — the profile composer that imports the guard.

<a id="dev-note"></a>
## Dev Note

None.
