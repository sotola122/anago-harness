# AGENTS.md — Fork records

Fork-only design documents, ADRs, and work logs live in this directory. An upstream-facing decision lives under `.agents/notes/`, not here.

This file is the convention. A session whose working directory is the repository root does not load it at the start. After that session reads or writes a path under `.anago/`, the next request includes this file. Keep later edits short: the rendered instruction baseline is capped at 65,536 bytes.

## Choose one file

Put each fact in one file.

| Kind | Path | Write here | Write in another file |
|---|---|---|---|
| Design | `.anago/designs/yyyy-mm-dd-topic.md` | Current structure, procedure, and open questions | A work timeline. The full text of a rejection that must survive the next rewrite |
| ADR | `.anago/adr/yyyy-mm-dd-topic.md` | A fork-only choice or rejection, and why | A full current specification. Command logs |
| Work log | `.anago/log/yyyy-mm-dd-topic.md` | What that work did and what was checked | An unstarted list. A comparison of alternatives |

Write an upstream-facing decision as an Agent Note under [`.agents/notes/`](../.agents/notes/README.md). Do not also write it here. Write a decision that stays in this fork as a file in this tree. Leave an upstream note describing upstream behavior; do not rewrite its body to match fork-only behavior. A note rewritten into fork behavior collides on every upstream sync and must update the English/Chinese pair and sidecar.

Link from a file here to an Agent Note with a relative Markdown link. Do not add a link from an Agent Note to `.anago/`.

[docs/fork.md](../docs/fork.md) stays the current-state description of the fork. Leave decision rationale here. Do not copy it into `docs/fork.md`.

Keep this convention out of product self-introduction text. It is for repository workers.

This directory is not the runtime home. The runtime home stays `~/.dsh` (`DSH_HOME`). Do not change that default as part of this convention. Do not put these records in project `.dsh/` or in `.dsh/wiki`: the wiki is English reference data, does not carry instructions to a future agent, and the project copy is gitignored except `wiki.yml`.

## Layout and names

The only file directly under `.anago/` is this `AGENTS.md`. Browse `designs/`, `adr/`, and `log/`, or search. Do not add `README.md` or `INDEX.md`: a catalogue duplicates the path and makes unrelated edits contend on one file.

Create the record at `yyyy-mm-dd-topic.md` in the directory for its kind. The date is the first-draft date, not an update date. `topic` uses lowercase ASCII letters and hyphens only. Do not create a second file with the same date and topic. Continue in that file.

Do not add `.zh.md`. Do not encode status in a folder name. The `Status:` line is the only status.

## Header and templates

Do not use YAML frontmatter. No loader reads this tree, and a leading `---` is frontmatter on paths that `verify-md-wrap` scans. Put `Key: value` lines under the title.

Write the title prefix and the headings in the Japanese words in the templates. Copy those words exactly. `# Agent Note:` and `## Problem` belong only in `.agents/notes/`.

A design may add headings of its own between `## 設計` and `## 代替案`.

Design `Status` is one of `draft`, `review`, `accepted`, `rejected`, `superseded`.

ADR `Status` is one of `proposed`, `accepted`, `rejected`, `superseded`.

On the line after `Date`, a design or an ADR may add one relative path, `Supersedes:` or `Superseded-by:`. Omit the line when it does not apply. Do not write the value `none`.

A work log has no `Status` line.

```markdown
# 設計: <題名>

Status: draft
Date: YYYY-MM-DD

## 目的
## 範囲外
## 設計
## 代替案
## 未決
```

```markdown
# ADR: <題名>

Status: proposed
Date: YYYY-MM-DD

## 問題
## 決定
## 代替案
## 帰結
```

```markdown
# 作業: <題名>

Date: YYYY-MM-DD

## YYYY-MM-DD
```

The first log section's date matches the filename and the `Date` line. Each later `## YYYY-MM-DD` heading is the day that section was appended.

## How each kind changes

Rewrite a design in place while its decision still holds. Do not add a changelog section. A `draft` or `review` design may describe work that has not happened yet. An `accepted` design states the adopted content in the present tense. `## 未決` lists only what is still undecided.

Create an ADR in the same change only for a rejection that must still be readable after the next design rewrite. Leave a relative link to that ADR in the design's `## 代替案`. A short comparison that may be deleted on rewrite stays only in `## 代替案`. Do not pair every design with an ADR.

Edit an ADR body while its status is `proposed`. After `accepted` or `rejected`, leave the body unchanged. To overturn the decision, write a new ADR. In the old file, set `Status` to `superseded` and add `Superseded-by:`. Change no other line.

Append a work log. Leave earlier sections unchanged. Correct a factual error in a new dated section. Keep a completed record. Put an unstarted list in the related design's `## 未決`, not in the log.

At the end of a work session, bring the relevant design to current content, add an ADR when a rejection must survive the next rewrite, and append what was done and what was checked to the log.

## Git

Track every file under `.anago/`. Do not add a `.gitignore` entry for this tree, and do not add a `.gitignore` inside it. Put throwaway notes in `tmp/`, which is already ignored.

The next clone has to be able to read a rejected alternative. A gitignored tree is also outside `verify-repository-references`.

In a tracked file, do not write a commit identifier of this repository: 7 to 40 hexadecimal digits that name one commit in the object database. Name a tag, a pull-request number, or a relative path. Do not add `.anago` to that check's exclusion list.

Do not write an API key, the contents of `.env`, the contents of a credential file, or a session body from the runtime home. Review logs for those values before they are committed. Invalidating a leaked value and removing it from history are outside this convention.

## Files that stay at the repository root

Leave [PROJECT_GUIDELINE.md](../PROJECT_GUIDELINE.md) at the repository root. Do not change its bytes. Link to that path when a record needs it.

`ANAGO_PLUGINS_DESIGN.md` and `ANAGO_TODO.md` remain the source until the next edit of each file. That edit moves the plugins design to `.anago/designs/2026-10-21-bundled-plugins.md` and deletes the root file. It moves unstarted `ANAGO_TODO.md` items into the related design's `## 未決`, moves completed items into dated files under `.anago/log/`, and deletes the root file. During the move, only one copy is the source. Update the references in `docs/fork.md` and its Chinese pair in that same edit, not before.

## Checks

Do not add `.anago` to a `doc-sync` allowlist. Appended log sections would then face the one-physical-line paragraph check, and a Japanese-only file would fail as a missing translation. Do not add a format check under `scripts/`.

Add a format check, and one line in the root `AGENTS.md`, only after either of these has happened: two commits add a fork design, ADR, or work log outside this tree, or three files here have a broken `Status` or a missing required heading. Put that check in `ci/fork/`, not in `doc-sync`. Check the path, the title prefix, and the `Status` word only.
