/**
 * Locale dictionary for the Session-sharing composer block.
 *
 * Every product string this plugin renders lives here; the composer reads the
 * block reason the watcher raises, so this dictionary is the only copy source.
 * @module @anago-harness/client-ui-session-share/src/client/locales
 */

/** Dictionary namespace owned by this plugin. */
export const NS = 'sessionShare'

/** Dictionary keys this plugin renders. */
export type SessionShareLocaleKey = 'composer.heldElsewhere'

/** English copy. */
export const en: Record<SessionShareLocaleKey, string> = {
  'composer.heldElsewhere':
    'This Session is open for writing in another process, so this page cannot send. Stop that process, or continue the Session there.',
}

/** Simplified Chinese copy. */
export const zh: Record<SessionShareLocaleKey, string> = {
  'composer.heldElsewhere':
    '该会话正由另一个进程写入，因此本页无法发送。请停止该进程，或在该处继续该会话。',
}
