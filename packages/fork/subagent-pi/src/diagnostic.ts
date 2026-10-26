/**
 * Credential-safe, byte-bounded diagnostics for the Pi subagent provider.
 *
 * `SubagentResult.diagnostic` is model-facing and contract-bound: it must not
 * carry tool inputs, file contents, environment values, credentials, or raw
 * protocol payloads, and it must fit 4096 UTF-8 bytes. This module builds it
 * from fixed fields plus the model's own error message, masks credential-shaped
 * fragments, and truncates on code-point boundaries.
 *
 * @module @anago-harness/subagent-pi/diagnostic
 */

/** Hard byte budget for one `SubagentResult.diagnostic` (seam contract). */
export const MAX_DIAGNOSTIC_BYTES = 4_096

/** Byte budget for the free-form model error message inside one diagnostic. */
const MAX_MESSAGE_BYTES = 1_024

/** Byte budget for a protocol-supplied stop-reason word quoted into a diagnostic. */
const MAX_REASON_BYTES = 64

/** Marker that replaces a credential-shaped fragment. */
const REDACTED = '[redacted]'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * Credential-shaped fragments replaced before any text leaves the provider.
 * Applied before truncation so a half-emitted token cannot survive the budget.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  // Authorization headers: `Bearer`/`Basic` followed by the token.
  /\b(?:Bearer|Basic)\s+\S+/gu,
  // Vendor-prefixed keys: OpenAI-style, GitHub, and AWS shapes.
  /\bsk-[A-Za-z0-9_-]{4,}/gu,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{8,}/gu,
  /\bgithub_pat_[A-Za-z0-9_]{8,}/gu,
  // Environment-style assignments and header pairs whose name names a
  // credential. The name may carry a vendor prefix and hyphenation
  // (`DEEPSEEK_API_KEY=`, `X-Api-Key:`); the value runs to the next
  // whitespace, which also masks the query value in `?api_key=...`.
  /\b[a-z0-9_-]*(?:key|token|secret|password)[a-z0-9_-]*\s*[=:]\s*\S+/giu,
]

/**
 * Cut text to a whole number of bytes without splitting a UTF-8 code point.
 * @param text - candidate text.
 * @param maxBytes - inclusive byte budget.
 * @returns `text` when it already fits, otherwise its longest code-point-aligned prefix.
 */
export function truncateUtf8(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return ''
  const bytes = encoder.encode(text)
  if (bytes.byteLength <= maxBytes) return text
  // TextDecoder replaces an incomplete trailing sequence with U+FFFD, so
  // dropping that replacement character yields a code-point-aligned prefix.
  return decoder.decode(bytes.subarray(0, maxBytes)).replace(/\uFFFD+$/u, '')
}

/**
 * Keep the trailing `maxBytes` of a UTF-8 string without splitting a code
 * point. Diagnostics quote the end of a failed child's stderr, where the error
 * text lives.
 * @param text - raw candidate text.
 * @param maxBytes - byte budget.
 * @returns the trailing text, or an empty string for a non-positive budget.
 */
export function truncateUtf8Tail(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return ''
  const bytes = encoder.encode(text)
  if (bytes.byteLength <= maxBytes) return text
  let start = bytes.byteLength - maxBytes
  while (start < bytes.byteLength && ((bytes[start] as number) & 0b1100_0000) === 0b1000_0000) {
    start += 1
  }
  return decoder.decode(bytes.subarray(start))
}

/**
 * Replace credential-shaped fragments with a fixed marker.
 * @param text - raw candidate text.
 * @returns the masked text.
 */
export function maskSecrets(text: string): string {
  let masked = text
  for (const pattern of SECRET_PATTERNS) masked = masked.replace(pattern, REDACTED)
  return masked
}

/** Fixed, non-secret facts describing one provider failure. */
export interface PiFailureFacts {
  /** Where the failure happened. */
  readonly stage: 'startup' | 'run' | 'teardown'
  /** Stable machine-readable classification, e.g. `model-error` or `protocol`. */
  readonly category: string
  /** Protocol stop reason, when one exists. */
  readonly stopReason?: string | undefined
  /** Process exit code, when the process produced one. */
  readonly exitCode?: number | null | undefined
  /** Terminating signal, when the process died from one. */
  readonly signal?: string | null | undefined
  /** Free-form model or transport detail, masked and byte-bounded before use. */
  readonly message?: string | undefined
}

/**
 * Render one failure as a fixed-field diagnostic within the seam's byte budget.
 * @param facts - the non-secret facts.
 * @returns the model-facing diagnostic string (never longer than 4096 bytes).
 */
export function failureDiagnostic(facts: PiFailureFacts): string {
  const fields = [`stage: ${facts.stage}`, `category: ${facts.category}`]
  if (facts.stopReason !== undefined) {
    fields.push(`stop reason: ${truncateUtf8(facts.stopReason, MAX_REASON_BYTES)}`)
  }
  if (facts.exitCode !== undefined && facts.exitCode !== null) {
    fields.push(`exit code: ${facts.exitCode}`)
  }
  if (facts.signal !== undefined && facts.signal !== null) {
    fields.push(`signal: ${facts.signal}`)
  }
  const head = `subagent-pi child failure (${fields.join('; ')})`
  if (facts.message === undefined) return truncateUtf8(head, MAX_DIAGNOSTIC_BYTES)
  const message = truncateUtf8(maskSecrets(facts.message), MAX_MESSAGE_BYTES)
  return truncateUtf8(`${head}: ${message}`, MAX_DIAGNOSTIC_BYTES)
}
