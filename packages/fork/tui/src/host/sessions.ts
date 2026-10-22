/**
 * Stored-Session listing for the terminal UI's `/resume` picker.
 *
 * The list comes from the same `sessionQuery` corpus the resume replay reads,
 * so the picker and the replay agree on which Sessions the profile can open.
 * Titles are not folded here: listing every Session's title costs one
 * observation each, and the header's creation time and directory already
 * identify a row.
 * @module @anago-harness/tui/host/sessions
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session-query'
import type { SessionOption } from '../app/pickers.ts'

/** Maximum Sessions offered by the picker, newest first. */
const SESSION_LIST_LIMIT = 50

/**
 * List resumable Sessions in the profile's store.
 * @param ctx - plugin context carrying the optional `sessionQuery` service.
 * @param currentSessionId - Session the UI currently shows, marked as current.
 * @returns selectable Sessions, newest first.
 * @throws when the profile mounts no `sessionQuery` service.
 */
export async function listSessionOptions(
  ctx: Context,
  currentSessionId: string | undefined,
): Promise<readonly SessionOption[]> {
  const query = ctx.get('sessionQuery')
  if (query === undefined) {
    throw new Error('the Session picker requires the sessionQuery service; mount @deepseek-ai/dsh-session-query in the profile')
  }
  const records = await query.listSessions()
  return records
    .filter(record => record.header.origin !== 'subagent')
    .slice(0, SESSION_LIST_LIMIT)
    .map(record => ({
      id: String(record.header.id),
      createdAt: record.header.createdAt,
      ...record.header.cwd === undefined ? {} : { cwd: record.header.cwd },
      current: currentSessionId === String(record.header.id),
    }))
}
