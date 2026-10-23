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
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-query'
import type { SessionOption } from '../app/pickers.ts'

/** Maximum Sessions offered by the picker, newest first. */
const SESSION_LIST_LIMIT = 50

/** Why a Session another process holds cannot be opened here. */
export const HELD_ELSEWHERE_REASON = 'Another DSH instance is running this Session'

/**
 * List resumable Sessions in the profile's store.
 *
 * A Session whose writer lease another process holds is listed with a reason
 * and stays unselectable; the probe is advisory, so the open path still treats
 * a lease it lost as the same refusal.
 * @param ctx - plugin context carrying the optional `sessionQuery` and `sessionPersistence` services.
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
  const persistence = ctx.get('sessionPersistence')
  const records = await query.listSessions()
  return Promise.all(records
    .filter(record => record.header.origin !== 'subagent')
    .slice(0, SESSION_LIST_LIMIT)
    .map(async (record) => {
      const id = String(record.header.id)
      const ownership = persistence === undefined ? undefined : await persistence.ownership(record.header.id)
      return {
        id,
        createdAt: record.header.createdAt,
        ...record.header.cwd === undefined ? {} : { cwd: record.header.cwd },
        current: currentSessionId === id,
        ...ownership === 'held-elsewhere' ? { disabledReason: HELD_ELSEWHERE_REASON } : {},
      }
    }))
}
