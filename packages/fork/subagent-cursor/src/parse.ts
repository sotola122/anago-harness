/**
 * Pure output mapping and bounded-output recovery for the Cursor provider.
 *
 * The CLI's `--output-format json` schema is unverified (design Q1), so the
 * mapping is deliberately strict: only a parseable, non-error payload becomes
 * `completed`. A parse failure, an `is_error` payload, or a non-zero exit is an
 * error result carrying the collected text, never a fail-open success.
 *
 * @module @anago-harness/subagent-cursor/parse
 */
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SubagentResult } from '@deepseek-ai/dsh-subagent'
import type { SubprocessOutputReader } from '@deepseek-ai/dsh-subprocess'
import type { OutputFormat } from './args.ts'
import { formatDiagnostic } from './diagnostic.ts'

/** One collected stream plus the facts needed to recover its complete text. */
export interface CollectedStream {
  /** Retained text: the complete stream, or its TAIL when truncated. */
  readonly text: string
  /** Whether bytes were dropped from {@link CollectedStream.text}. */
  readonly truncated: boolean
  /** Full-stream spill file, when one survived. */
  readonly spillPath?: string | undefined
}

/** Complete-or-tail text selected for parsing. */
export interface RecoveredOutput {
  /** Text to parse. */
  readonly text: string
  /** Whether {@link RecoveredOutput.text} is the complete stream. */
  readonly complete: boolean
}

/** Exit facts plus the recovered stdout handed to {@link parseOutcome}. */
export interface RunOutputs {
  /** Configured output format. */
  readonly outputFormat: OutputFormat
  /** Process exit code; `null` when a signal ended the process. */
  readonly exitCode: number | null
  /** Terminating signal, when one ended the process. */
  readonly signal: NodeJS.Signals | null
  /** Collected (or spill-recovered) stdout. */
  readonly stdout: string
  /** Whether {@link RunOutputs.stdout} is the complete stream. */
  readonly stdoutComplete: boolean
}

/**
 * Wrap text as the seam's assistant output, keeping the empty case truly empty.
 * @param text - final or collected text.
 * @returns one text block, or no blocks for an empty string.
 */
export function textOutput(text: string): readonly ContentBlock[] {
  return text.length === 0 ? [] : [{ type: 'text', text }]
}

/**
 * Snapshot one collect-mode reader without awaiting anything.
 * @param reader - the handle's reader, when the stream was collected.
 * @returns the retained text and truncation facts.
 */
export function readCollectedStream(reader: SubprocessOutputReader | undefined): CollectedStream {
  if (reader === undefined) return { text: '', truncated: false }
  const read = reader.readFrom(0)
  return {
    text: read.text,
    truncated: read.lossy,
    ...(read.spillPath === undefined ? {} : { spillPath: read.spillPath }),
  }
}

/**
 * Re-read a truncated stream from its spill file before parsing. Collection
 * keeps only the TAIL, and a JSON payload whose head was dropped can never
 * parse, so the complete stream is the only usable input.
 * @param stream - the collected stream.
 * @param read - reader for a spill path (injected so this stays testable).
 * @returns the complete text when recoverable, else the retained tail.
 */
export async function recoverCollectedOutput(
  stream: CollectedStream,
  read: (path: string) => Promise<string>,
): Promise<RecoveredOutput> {
  if (!stream.truncated) return { text: stream.text, complete: true }
  if (stream.spillPath === undefined) return { text: stream.text, complete: false }
  try {
    return { text: await read(stream.spillPath), complete: true }
  } catch {
    return { text: stream.text, complete: false }
  }
}

/**
 * Map one finished process to a seam result.
 *
 * | exit | format | payload | stop reason |
 * | --- | --- | --- | --- |
 * | `0` | `json` | parses, `is_error` falsy | `completed` (`result` text, else stdout) |
 * | `0` | `json` | parses, `is_error` truthy | `error` |
 * | `0` | `json` | does not parse | `error` |
 * | `0` | `text` | any | `completed` (raw stdout) |
 * | non-zero or signalled | any | any | `error` (structured fields) |
 *
 * @param outputs - exit facts and recovered stdout.
 * @returns the terminal result; never `aborted` (cancellation owns that).
 */
export function parseOutcome(outputs: RunOutputs): SubagentResult {
  const collected = textOutput(outputs.stdout)
  if (outputs.exitCode !== 0) {
    return {
      output: collected,
      diagnostic: formatDiagnostic({
        stage: 'run',
        category: outputs.exitCode === null ? 'signal' : 'exit-code',
        exitCode: outputs.exitCode,
        signal: outputs.signal,
      }),
      stopReason: 'error',
    }
  }
  if (outputs.outputFormat === 'text') return { output: collected, stopReason: 'completed' }
  const parsed = tryParseJson(outputs.stdout)
  if (parsed === undefined) {
    return {
      output: collected,
      diagnostic: formatDiagnostic({
        stage: 'run',
        category: 'parse',
        message: outputs.stdoutComplete
          ? 'stdout is not valid JSON'
          : 'stdout is not valid JSON and its complete form was unavailable (truncated without a usable spill file)',
      }),
      stopReason: 'error',
    }
  }
  if (isErrorPayload(parsed)) {
    return {
      output: collected,
      diagnostic: formatDiagnostic({
        stage: 'run',
        category: 'product-error',
        message: payloadMessage(parsed),
      }),
      stopReason: 'error',
    }
  }
  return { output: textOutput(payloadResultText(parsed) ?? outputs.stdout), stopReason: 'completed' }
}

/** Parse stdout, treating any throw as "not JSON". */
function tryParseJson(text: string): unknown {
  try {
    const parsed: unknown = JSON.parse(text)
    return parsed
  } catch {
    return undefined
  }
}

/** Read a JSON flag that the unverified schema may encode as a boolean or string. */
function isTruthyFlag(value: unknown): boolean {
  return value === true || value === 1 || value === 'true' || value === '1'
}

/** Whether a parsed payload advertises a product-level failure. */
function isErrorPayload(parsed: unknown): boolean {
  if (typeof parsed !== 'object' || parsed === null) return false
  return isTruthyFlag((parsed as { is_error?: unknown }).is_error)
}

/** The payload's final text, when it carries one. */
function payloadResultText(parsed: unknown): string | undefined {
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const result = (parsed as { result?: unknown }).result
  return typeof result === 'string' ? result : undefined
}

/** A masked-later product message for an `is_error` payload. */
function payloadMessage(parsed: unknown): string {
  const result = payloadResultText(parsed)
  return result !== undefined && result.trim().length > 0
    ? result
    : 'the CLI reported is_error without a result message'
}
