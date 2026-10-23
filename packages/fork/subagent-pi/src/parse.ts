/**
 * Incremental mapping from the Pi CLI's `--mode json` stdout to a seam result.
 *
 * The CLI writes one JSON object per line. This parser keeps only the last
 * assistant `message_end`, whether `agent_settled` reported an abort, and a
 * count of unparseable lines — enough to decide success, failure, or abort
 * without retaining the raw protocol stream (which may carry tool payloads and
 * credentials). Failures reported in the stream decide the outcome even when
 * the process exits 0; a malformed stream fails closed.
 *
 * @module @anago-harness/subagent-pi/parse
 */
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SubagentResult } from '@deepseek-ai/dsh-subagent'
import { failureDiagnostic, maskSecrets, truncateUtf8Tail } from './diagnostic.ts'

/** One assistant message recovered from a `message_end` event. */
export interface PiAssistantMessage {
  /** Text block contents in their original order. */
  readonly text: readonly string[]
  /** Pi model stop reason, when the message carries one. */
  readonly stopReason?: string | undefined
  /** Model-reported error text, when the stop reason is `error`. */
  readonly errorMessage?: string | undefined
}

/** Exit facts of the finished child process. */
export interface PiProcessOutcome {
  /** Exit code; null when a signal ended the process. */
  readonly exitCode: number | null
  /** Terminating signal, when one ended the process. */
  readonly signal: NodeJS.Signals | null
  /** Raw stderr text collected for the failure diagnostic. */
  readonly stderr?: string
}


/** Whether a parsed JSONL value is a non-null object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Streaming decoder for the Pi JSONL protocol. Feed stdout chunks through
 * {@link PiJsonlStream.push}, finish with {@link PiJsonlStream.end}, then read
 * {@link PiJsonlStream.output} or {@link PiJsonlStream.outcome}.
 */
export class PiJsonlStream {
  private pending = ''
  private assistant: PiAssistantMessage | undefined
  private answer: readonly string[] = []
  private aborted = false
  private malformed = 0

  /**
   * Feed one decoded stdout chunk and consume every complete line in it.
   * @param chunk - UTF-8 text appended to the unparsed tail.
   */
  push(chunk: string): void {
    this.pending += chunk
    let newline = this.pending.indexOf('\n')
    while (newline >= 0) {
      const line = this.pending.slice(0, newline).trim()
      this.pending = this.pending.slice(newline + 1)
      if (line.length > 0) this.consume(line)
      newline = this.pending.indexOf('\n')
    }
  }

  /**
   * Consume a final line that arrived without a trailing newline.
   */
  end(): void {
    const line = this.pending.trim()
    this.pending = ''
    if (line.length > 0) this.consume(line)
  }

  /**
   * The assistant text collected so far, as seam output blocks. Empty
   * assistant messages are skipped, so the answer is the last message that
   * carried visible text.
   * @returns the collected text blocks, or none.
   */
  output(): readonly ContentBlock[] {
    return this.answer.map(text => ({ type: 'text', text }))
  }

  /**
   * Map the collected stream plus the process exit to a seam result.
   *
   * | stream | exit | stop reason |
   * | --- | --- | --- |
   * | unparseable line | any | `error` (fails closed) |
   * | assistant stop | 0 or non-zero | `completed` |
   * | assistant `length`/`max-tokens` | any | `max-tokens` |
   * | assistant `error` | any | `error` (model message as diagnostic) |
   * | assistant `aborted`, or `agent_settled.aborted` | any | `aborted` |
   * | no assistant message | non-zero or signalled | `error` (exit facts) |
   * | no assistant message | 0 | `error` (no answer) |
   *
   * @param process - the finished child's exit facts.
   * @returns the terminal result; never `aborted` because of local cancellation
   * (the seam settles that itself).
   */
  outcome(process: PiProcessOutcome): SubagentResult {
    if (this.malformed > 0) {
      return this.failure(
        'protocol',
        `stdout carried ${this.malformed} unparseable JSONL line(s)`,
        process,
      )
    }
    const assistant = this.assistant
    if (assistant === undefined) {
      return this.missingAnswer(process)
    }
    switch (assistant.stopReason) {
      case undefined:
      case 'stop':
        return this.aborted
          ? { output: this.output(), stopReason: 'aborted' }
          : { output: this.output(), stopReason: 'completed' }
      case 'length':
      case 'max-tokens':
        return { output: this.output(), stopReason: 'max-tokens' }
      case 'aborted':
        return { output: this.output(), stopReason: 'aborted' }
      case 'error':
        return this.failure(
          'model-error',
          assistant.errorMessage ?? 'the child reported an error without a message',
          process,
        )
      default:
        return this.failure(
          'stop-reason',
          `the child stopped with the unrecognized reason "${assistant.stopReason}"`,
          process,
        )
    }
  }

  /** Record an error result carrying the collected output. */
  private failure(category: string, message: string, process: PiProcessOutcome): SubagentResult {
    const base = failureDiagnostic({
      stage: 'run',
      category,
      exitCode: process.exitCode,
      signal: process.signal,
      message,
    })
    // The model sees only this diagnostic, so quote the end of the child's
    // stderr here: an unknown provider or a rejected flag otherwise looks like
    // an empty answer. Masking and the byte budget run before the append.
    const tail = process.stderr === undefined
      ? ''
      : truncateUtf8Tail(maskSecrets(process.stderr), 1_024)
    return {
      output: this.output(),
      diagnostic: tail.length === 0 ? base : `${base}\nstderr tail: ${tail}`,
      stopReason: 'error',
    }
  }

  /** Map the absence of a usable assistant message to an error result. */
  private missingAnswer(process: PiProcessOutcome): SubagentResult {
    const category = process.signal !== null
      ? 'signal'
      : process.exitCode !== null && process.exitCode !== 0 ? 'exit-code' : 'protocol'
    return this.failure(
      category,
      category === 'protocol' ? 'the child produced no assistant message' : 'the child exited without an assistant message',
      process,
    )
  }

  /** Apply one parsed line to the collected stream state. */
  private consume(line: string): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      this.malformed += 1
      return
    }
    if (!isRecord(parsed) || typeof parsed.type !== 'string') {
      this.malformed += 1
      return
    }
    if (parsed.type === 'agent_settled') {
      this.aborted = parsed.aborted === true
      return
    }
    if (parsed.type !== 'message_end') return
    this.consumeMessage(parsed.message)
  }

  /** Record one `message_end` when it carries an assistant message. */
  private consumeMessage(message: unknown): void {
    if (!isRecord(message) || typeof message.role !== 'string') {
      this.malformed += 1
      return
    }
    if (message.role !== 'assistant') return
    const content = message.content
    if (!Array.isArray(content)) {
      this.malformed += 1
      return
    }
    const text: string[] = []
    for (const block of content) {
      if (isRecord(block) && block.type === 'text' && typeof block.text === 'string') {
        text.push(block.text)
      }
    }
    const stopReason = typeof message.stopReason === 'string' ? message.stopReason : undefined
    const errorMessage = typeof message.errorMessage === 'string' ? message.errorMessage : undefined
    this.assistant = {
      text,
      ...(stopReason === undefined ? {} : { stopReason }),
      ...(errorMessage === undefined ? {} : { errorMessage }),
    }
    const visible = text.filter(part => part.length > 0)
    if (visible.length > 0) this.answer = visible
  }
}
