---
kind: upgrade-guide
description: "Viewing a Session no longer takes its writer lease, idle Agents release it, and a Session another process holds opens read-only."
---

# Cross-process Session sharing

English | [中文](guide.zh.md)

## Change

- `session/follow` gains an optional `mode: 'activate' | 'read'`. `activate` is the default and keeps the previous behavior, where a prepared observation promotes an Agent in the background. `read` never activates an Agent, starts from the last physically persisted event (`savedCursor`), and omits synthetic repair closers. The Web client always opens a conversation with `read`; sending a message still resumes an Agent on demand.
- `SessionPersistence` gains `ownership(id)`, returning `free`, `owned-here`, `held-elsewhere`, `missing`, or `unknown`. The probe creates no directory or lock file and takes no ownership; the kernel lease remains the only authority.
- `api-session/removed` is no longer emitted when an ordinary Agent detaches. A new `api-session/detached` event says the stored Session remains readable: clients keep the row, history, and draft, and clear live-Agent availability. `removed` now reports only a durable subagent row leaving the live catalog with its run.
- `SessionController` gains `releaseOnIdle` (default false), `releaseIdleDelayMs` (default 0), and `releaseRetryMs` (default 1000). When enabled, a Session's Agent is disposed once it is idle with an empty inbox, no live child Agent, no outstanding `ctx.agents.hold()`, and no admitted operation; the disposal releases the Session's write lease. `anago-web` enables it with a 250 ms delay.
- The new `@anago-harness/client-ui-session-share` plugin blocks the Web composer (`lock: 'all'`) for a Session another DSH process holds, and unlocks it after the lease is released.
- The terminal picker lists a Session held elsewhere as disabled with a reason and refuses to open it.

## Migration

1. A custom `SessionPersistence` backend implements `ownership`. `unknown` must mean undecidable, never free.
2. A client that treats `api-session/removed` as "the Agent is gone but the stored Session stays" must also handle `api-session/detached`; `removed` now implies deletion.
3. A `session/follow` caller that relies on the previous background activation passes `mode: 'activate'`. Omitting the field keeps that behavior, so only the Web client changed.
4. Background work that outlives an idle transition (a memory review, a goal continuation round, a child Agent) must hold the Agent with `ctx.agents.hold(agent)`; otherwise enabling `releaseOnIdle` aborts it. The bundled memory review and goal round driver already hold.
5. Enabling `releaseOnIdle` trades the next message's latency for the lease: the next prompt resumes the Agent and reads the log again. Disable it to keep Agents attached.
