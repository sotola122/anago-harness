/**
 * Waterfall answerers for the two human-interaction services.
 *
 * Both events are waterfalls: a handler that has nothing to show must call
 * `next()` so another answerer, or the service's fail-closed default, decides.
 * @module @anago-harness/tui/host/waterfalls
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type { AskUserQuestionAnswer, AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'

/** Answerer shown for an approval request owned by this UI. */
export interface ApprovalPresenter {
  /**
   * Ask the human to decide one request.
   * @param request - pending approval request.
   * @returns the outcome the approval service records.
   */
  askApproval(request: ApprovalRequest): Promise<ApprovalOutcome>
}

/** Answerer shown for a user-questions request owned by this UI. */
export interface QuestionsPresenter {
  /**
   * Ask the human to answer one question batch.
   * @param request - pending question batch.
   * @returns the structured answer, or `null` to defer to the next answerer.
   */
  askQuestions(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer | null>
}

/**
 * Register the approval answerer for the Agent this UI currently owns.
 * @param ctx - plugin context.
 * @param ownedAgent - reads the current Agent, if a session is open.
 * @param presenter - reads the current presenter, if the UI has started.
 */
export function registerApprovalWaterfall(
  ctx: Context,
  ownedAgent: () => Agent | null,
  presenter: () => ApprovalPresenter | null,
): void {
  ctx.on('approval/request', (request, next) => {
    const agent = ownedAgent()
    if (agent === null || request.agent.id !== agent.id) return next()
    const answerer = presenter()
    if (answerer === null) return next()
    return answerer.askApproval(request)
  })
}

/**
 * Register the user-questions answerer for the Agent this UI currently owns.
 * @param ctx - plugin context.
 * @param ownedAgent - reads the current Agent, if a session is open.
 * @param presenter - reads the current presenter, if the UI has started.
 */
export function registerQuestionsWaterfall(
  ctx: Context,
  ownedAgent: () => Agent | null,
  presenter: () => QuestionsPresenter | null,
): void {
  ctx.on('user-questions/request', (request, next) => {
    const agent = ownedAgent()
    if (agent === null || (request.agent !== undefined && request.agent.id !== agent.id)) return next()
    const answerer = presenter()
    if (answerer === null) return next()
    return answerer.askQuestions(request).then(answer => answer ?? next())
  })
}
