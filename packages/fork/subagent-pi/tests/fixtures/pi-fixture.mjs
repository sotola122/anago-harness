#!/usr/bin/env node
// Deterministic stand-in for the Pi 1.3.0 `--print --mode json` protocol.
// The provider spawns this file with the real argv (`--print --mode json ... --
// <task>`); the mode arrives through the provider's env passthrough so every
// case also proves environment delivery. Never contacts a model.
const mode = process.env.PI_FIXTURE_MODE ?? 'success'
const task = process.argv.at(-1) ?? ''

/** Write one JSONL protocol event. */
function emit(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`)
}

/** Build the subset of an assistant message the provider reads. */
function assistant(content, stopReason, errorMessage) {
  const message = { role: 'assistant', content, stopReason, timestamp: 0 }
  if (errorMessage !== undefined) message.errorMessage = errorMessage
  return message
}

const thinking = { type: 'thinking', thinking: 'weighing the request' }

emit({ type: 'session', version: 3, id: 'fixture-session' })
emit({ type: 'agent_start' })
emit({ type: 'turn_start' })

switch (mode) {
  case 'error': {
    const message = assistant(
      [{ type: 'text', text: 'partial answer' }],
      'error',
      '429 Too Many Requests: OPENAI_API_KEY=sk-fixture-secret',
    )
    emit({ type: 'message_end', message })
    emit({ type: 'agent_end', messages: [message], willRetry: false })
    emit({ type: 'agent_settled', aborted: false })
    break
  }
  case 'exit': {
    // A crash with no usable assistant message; the exit code is the failure.
    process.exitCode = 2
    break
  }
  case 'malformed': {
    process.stdout.write('this line is not json\n')
    const message = assistant([{ type: 'text', text: 'answer after noise' }], 'stop')
    emit({ type: 'message_end', message })
    emit({ type: 'agent_settled', aborted: false })
    break
  }
  case 'max-tokens': {
    emit({ type: 'message_end', message: assistant([{ type: 'text', text: 'cut off' }], 'length') })
    emit({ type: 'agent_settled', aborted: false })
    break
  }
  default: {
    emit({ type: 'message_start', message: assistant([], 'pending') })
    emit({
      type: 'message_update',
      message: assistant([thinking], 'pending'),
      assistantMessageEvent: { type: 'thinking_delta', delta: 'weighing the request' },
    })
    const message = assistant([thinking, { type: 'text', text: `done: ${task}` }], 'stop')
    emit({ type: 'message_end', message })
    emit({ type: 'turn_end', message, toolResults: [] })
    emit({ type: 'agent_end', messages: [message], willRetry: false })
    emit({ type: 'agent_settled', aborted: false })
    break
  }
}
