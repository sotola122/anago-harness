/**
 * Japanese language pack, host half. The browser half in `src/client/` owns
 * the locale definition and every dictionary; this entry exists so the
 * package holds an ordinary Loader row whose bare specifier the client module
 * system serves the `./client` bundle for.
 * @module @anago-harness/client-locale-ja
 */

/** Host plugin body — no host-side behavior for this language pack. */
export function apply(): void {}
