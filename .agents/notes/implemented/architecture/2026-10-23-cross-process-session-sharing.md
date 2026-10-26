# Agent Note: Cross-process Session sharing between the Web UI and the terminal UI

Status: implemented

English | [中文](2026-10-23-cross-process-session-sharing.zh.md)

## Problem

The Web UI and the terminal UI share one `$DSH_HOME/sessions` store, but the Web could not share a Session with a running terminal:

- Opening a conversation called `session/follow`, which promoted a prepared observation and resumed an Agent in the background. Viewing therefore took the Session's kernel write lease, so the terminal could not open a Session the Web had merely looked at.
- A cold observation appended synthetic `interruptedTurnClosers` and reported their seq as the cursor, so a follower started past the physically persisted prefix and would treat the writer's real event at that seq as a duplicate.
- Disposing an Agent emitted `api-session/removed`; the client flagged the Session as removed, dropping the row's composer even though the stored Session remained.
- A Host that never released an idle Agent held the lease for its whole lifetime, even with no browser attached.

## Decision

1. **Viewing is passive.** `session/follow` gains `mode: 'activate' | 'read'`, defaulting to the historical `activate`. `read` never promotes, never resumes, starts at `savedCursor` (the last physically persisted event), and omits synthetic repair closers. The Web client always opens with `read` and resumes only through an explicit write operation.
2. **Agent departure is not Session deletion.** `session/disposed` emits `api-session/detached` for an ordinary conversation; a durable subagent row keeps `api-session/removed`, which matches its leave-the-catalog lifetime. Clients keep the ordinary row, history, draft, and retention, and clear live-Agent availability.
3. **The lease is held only while work runs.** `releaseOnIdle` disposes an idle Agent only when its inbox is empty, no live child Agent exists, `ctx.agents.holds(agent)` is zero, no admission is in flight, and no maintenance activity is pending (`whenIdle()` settles). Prompt, queue edits, model selection, rename, fork, and attachment admission share one per-Session gate, so a release cannot race an operation that already resolved the Agent.
4. **Background work owns its lifetime.** The turn-end memory review and the goal round driver take `ctx.agents.hold(agent)` for their pass and release it on every exit path; a refused hold skips the work instead of racing disposal.
5. **Ownership is advisory.** `SessionPersistence.ownership()` probes the same platform lock without creating a directory or lock file; `unknown` never means free. The kernel lease at open and prompt remains the only authority. The Web blocks its composer with `lock: 'all'` and polls the probe; the terminal dims a held row, shows the reason, and refuses to open it.
6. **Live read-only viewing reuses the reader.** A read-mode follower polls the stored revision and reads the delta through the existing read API; no second log parser or file watcher was added.

## Alternatives considered

- **Two concurrent writers with conflict resolution.** Rejected: the append-only log and contiguous seq contract have no merge semantics.
- **A persistence `watch` seam with `fs.watch` and incremental frame decoding.** Deferred: the revision poll reuses the existing validated reader, and the provider can gain an internal byte-offset fast path if measurement demands it.
- **Treating detach as removal and re-adding the row.** Rejected: it drops the draft and history, and the re-add races the removal event.
- **Releasing only when the browser disconnects.** Rejected: a long-running Host keeps the lease with no client attached, which is the original problem.

## Consequences

- The first message after an idle release resumes the Agent and re-reads the log; a deployment trades that latency for cross-surface sharing and can turn `releaseOnIdle` off.
- Read-only projections (inbox, model, goal) refresh on handoff or reload rather than live; the transcript is the live surface.
- A schedule follow-up that fires while another process holds the Session fails with the writer-held error.
- A custom `SessionPersistence` backend must implement `ownership`; the abstract method is a breaking change for implementers.
