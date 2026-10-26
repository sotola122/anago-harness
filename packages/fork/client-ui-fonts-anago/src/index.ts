/**
 * Japanese-first Web UI fonts, node half. The empty apply exists so the package
 * holds a Loader row whose `./client` bundle the client module system serves to
 * the browser; every font and stylesheet rule is in that browser half.
 * @module @anago-harness/client-ui-fonts-anago
 */

/** Host plugin body — the fonts are a browser-only surface. */
export function apply(): void {}
