/**
 * Credential-safe, byte-bounded diagnostics for the Cursor subagent provider.
 *
 * `SubagentResult.diagnostic` is model-facing and contract-bound: it must not
 * carry tool inputs, file contents, environment values, credentials, or raw
 * protocol payloads, and it must fit 4096 UTF-8 bytes. This module builds it
 * from fixed fields only, masks credential-shaped fragments, and truncates on
 * code-point boundaries so a multi-byte character is never split.
 *
 * @module @anago-harness/subagent-cursor/diagnostic
 */

/** Hard byte budget for one `SubagentResult.diagnostic` (seam contract). */
export const MAX_DIAGNOSTIC_BYTES = 4096

/** Byte budget for the free-form `message` field inside one diagnostic. */
export const MAX_DIAGNOSTIC_MESSAGE_BYTES = 1024

/** Phase that produced a diagnostic. */
export type DiagnosticStage = 'config' | 'startup' | 'run' | 'teardown'

/** Fixed, non-secret facts describing one provider failure. */
export interface DiagnosticFacts {
  /** Where the failure happened. */
  readonly stage: DiagnosticStage
  /** Stable machine-readable classification, e.g. `exit-code` or `parse`. */
  readonly category: string
  /** Process exit code, when the process produced one. */
  readonly exitCode?: number | null | undefined
  /** Terminating signal, when the process died from one. */
  readonly signal?: string | null | undefined
  /** Free-form provider-authored detail, masked and byte-bounded before use. */
  readonly message?: string | undefined
}

const MASKED = '«redacted»'

/** Credential-shaped fragments replaced before any text leaves the provider. */
const SECRET_PATTERNS: readonly (readonly [RegExp, string])[] = [
  // Environment-style assignments: KEY=value, anchored on a word boundary like
  // the other patterns, so an assignment is masked wherever its name starts
  // (right after a quote, in a URL query `?api_key=`, after `;`/`,`/`(`, in
  // `--api-key=…`), not only after whitespace.
  [/\b([A-Za-z_][A-Za-z0-9_]{1,})=(\S+)/g, `$1=${MASKED}`],
  // Authorization headers: Bearer/Basic <token>.
  [/\b(Bearer|Basic)\s+\S+/gi, `$1 ${MASKED}`],
  // Vendor-prefixed API keys: OpenAI-style, GitHub, Slack, AWS.
  [/\bsk-[A-Za-z0-9_-]{4,}/g, `sk-${MASKED}`],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{8,}/g, MASKED],
  [/\bgithub_pat_[A-Za-z0-9_]{8,}/g, MASKED],
  [/\bxox[abposr]-[A-Za-z0-9-]{8,}/g, MASKED],
  [/\bAKIA[0-9A-Z]{16}\b/g, MASKED],
  // Header-style pairs: `NAME: value`. The name must look like a header
  // (hyphen/underscore separated) or be one of the single-token credential
  // headers, so ordinary prose such as "parse error: unexpected token" stays
  // readable. The value covers the rest of the line, because a credential
  // header may put a scheme word before the token ("Authorization: Token
  // abc123") and stopping at the first word would leave the token in place. A
  // value that starts with a bare `Bearer`/`Basic` scheme word is left to the
  // rule above, which already masked the token that follows it.
  [
    new RegExp(
      String.raw`\b([a-z][a-z0-9]*(?:[-_][a-z0-9]+)+`
      + String.raw`|Authorization|Cookie|Api-?Key|Token|Password|Secret):[ \t]+`
      + String.raw`((?!Bearer\b|Basic\b)\S+(?:[ \t]+\S+)*)`,
      'gi',
    ),
    `$1: ${MASKED}`,
  ],
]

/**
 * Cut text to a whole number of bytes without splitting a UTF-8 code point.
 * @param text - candidate text.
 * @param maxBytes - inclusive byte budget.
 * @returns `text` when it already fits, otherwise its longest code-point-aligned prefix.
 */
export function truncateUtf8(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return ''
  const bytes = Buffer.from(text, 'utf8')
  if (bytes.length <= maxBytes) return text
  let end = maxBytes
  // A continuation byte at the cut means its lead byte sits before it: back up
  // to that lead byte so the partial sequence is dropped whole.
  while (end > 0) {
    const byte = bytes[end]
    if (byte === undefined || (byte & 0xc0) !== 0x80) break
    end--
  }
  return bytes.subarray(0, end).toString('utf8')
}

/**
 * Replace credential-shaped fragments with a fixed marker. Applied before
 * truncation so a half-emitted token can never survive the byte budget.
 * @param text - raw candidate text.
 * @returns the masked text.
 */
export function maskSecrets(text: string): string {
  let masked = text
  for (const [pattern, replacement] of SECRET_PATTERNS) masked = masked.replace(pattern, replacement)
  return masked
}

/**
 * Render one failure as a fixed-field diagnostic within the seam's byte budget.
 * @param facts - the non-secret facts.
 * @returns the model-facing diagnostic string (never longer than 4096 bytes).
 */
export function formatDiagnostic(facts: DiagnosticFacts): string {
  const fields = [`stage: ${facts.stage}`, `category: ${facts.category}`]
  if (facts.exitCode !== undefined && facts.exitCode !== null) fields.push(`exit code: ${facts.exitCode}`)
  if (facts.signal !== undefined && facts.signal !== null) fields.push(`signal: ${facts.signal}`)
  const head = `subagent-cursor child failure (${fields.join('; ')})`
  if (facts.message === undefined) return truncateUtf8(head, MAX_DIAGNOSTIC_BYTES)
  const message = truncateUtf8(maskSecrets(facts.message), MAX_DIAGNOSTIC_MESSAGE_BYTES)
  return truncateUtf8(`${head}: ${message}`, MAX_DIAGNOSTIC_BYTES)
}
