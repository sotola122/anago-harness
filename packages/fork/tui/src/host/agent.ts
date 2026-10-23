/**
 * DSH Agent lifecycle for the TUI: open a fresh or resumed Session, send
 * prompts through follow-up/steering, and abort the running turn.
 * @module @anago-harness/tui/host/agent
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { HELD_ELSEWHERE_REASON } from './sessions.ts'

/** How long to wait for the agent-loop row to publish its factory. */
const FACTORY_RETRY_MS = 2_000

/** Interval between factory-availability retries. */
const FACTORY_RETRY_INTERVAL_MS = 50

/** The one-line refusal for an invocation that resolves no usable route. */
const NO_MODEL_GUIDANCE = 'no provider/model configured: pass --provider and --model, or configure '
  + 'agentDefaultModel.provider and agentDefaultModel.model in the profile'

/** The per-invocation overrides this app passes to a new Agent. */
export interface SessionOpenOptions {
  /** Persisted Session id to resume instead of creating a fresh one. */
  readonly resume?: string | undefined
  /** Model id overriding the configured default; the default fills the provider half. */
  readonly model?: string | undefined
  /** Provider route overriding the configured default; the default fills the model half. */
  readonly provider?: string | undefined
}

/** The complete provider/model pair every Agent request needs. */
export interface AgentRoute {
  /** Registered provider route. */
  readonly provider: string
  /** Provider-owned model id. */
  readonly model: string
}

/** One opened Agent and the route resolved for it. */
export interface OpenedAgent {
  /** The owned handle; the caller disposes it before exiting. */
  readonly handle: AgentHandle
  /** The route the Agent requests start from. */
  readonly route: AgentRoute
}

/**
 * Resolve the configured default route, then replace only the halves the
 * invocation names. `ctx.get` keeps the row startable when a profile omits the
 * default-model service; the missing route fails here rather than in the first
 * model request.
 * @param ctx - plugin context that may carry `agentDefaultModel`.
 * @param options - invocation overrides.
 * @returns a complete provider/model pair.
 */
function agentRouteOf(ctx: Context, options: SessionOpenOptions): AgentRoute {
  const fallback = ctx.get('agentDefaultModel')?.currentSelection()
  const provider = options.provider === undefined || options.provider === ''
    ? fallback?.provider
    : options.provider
  const model = options.model === undefined || options.model === ''
    ? fallback?.model
    : options.model
  if (provider === undefined || provider === '' || model === undefined || model === '') {
    throw new Error(NO_MODEL_GUIDANCE)
  }
  return { provider, model }
}

/**
 * Wait briefly for the agent-loop factory before giving up.
 *
 * App rows can mount before the row that installs the factory in a slow tree;
 * the reference TUI retries the same way. Only the factory-absence rejection is
 * retried, so a real creation failure surfaces immediately.
 * @param open - session-opening attempt.
 * @returns the opened handle.
 */
async function openWithFactoryRetry(open: () => Promise<AgentHandle>): Promise<AgentHandle> {
  const deadline = Date.now() + FACTORY_RETRY_MS
  for (;;) {
    try {
      return await open()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!/no agent factory registered/i.test(message) || Date.now() >= deadline) throw error
      await new Promise(resolve => setTimeout(resolve, FACTORY_RETRY_INTERVAL_MS))
    }
  }
}

/**
 * Create a fresh Agent or resume the persisted Session the invocation named.
 * @param ctx - plugin context carrying `ctx.agents` and optionally the default model.
 * @param options - resume and model overrides.
 * @returns the owned Agent handle and the resolved route; the caller disposes the handle before exiting.
 */
export async function openAgentSession(ctx: Context, options: SessionOpenOptions): Promise<OpenedAgent> {
  const route = agentRouteOf(ctx, options)
  const handle = await openWithFactoryRetry(async () => {
    if (options.resume === undefined || options.resume === '') {
      return ctx.agents.create({
        sessionId: SessionId(randomUUID()),
        meta: { cwd: process.cwd() },
        agentOptions: route,
      })
    }
    try {
      return await ctx.agents.resume({
        resumeSessionId: SessionId(options.resume),
        agentOptions: route,
      })
    } catch (error) {
      // Another process holds the Session's writer lease: report the same
      // reason the picker shows instead of the raw kernel error.
      if (error instanceof Error && error.name === 'SessionAlreadyOwnedError') {
        throw new Error(HELD_ELSEWHERE_REASON, { cause: error })
      }
      throw error
    }
  })
  return { handle, route }
}

/**
 * Deliver one submitted prompt: follow-up while idle, steering while running.
 * @param agent - the Agent that owns the turn.
 * @param text - exact submitted text.
 */
export function sendPrompt(agent: Agent, text: string): void {
  const message = createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
  if (agent.status === 'running') agent.steer(message)
  else agent.followup(message)
}

/**
 * Abort the Agent's active turn without discarding queued input.
 * @param agent - the Agent to interrupt.
 */
export function abortAgent(agent: Agent): void {
  agent.cancel({ kind: 'user' }, { keepInbox: true })
}
