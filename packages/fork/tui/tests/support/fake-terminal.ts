/**
 * Test terminal: records pi-tui output and replays keystrokes.
 * @module @anago-harness/tui/tests/support/fake-terminal
 */

import { stripTerminalSequences, type ProgramStatus, type Terminal } from '../../src/term/pi-tui.ts'

/** An in-memory {@link Terminal} for renderer and input tests. */
export class FakeTerminal implements Terminal {
  columns = 96
  rows = 30
  kittyProtocolActive = false
  started = false
  readonly writes: string[] = []
  private input: ((data: string) => void) | null = null

  start(onInput: (data: string) => void, _onResize: () => void): void {
    this.started = true
    this.input = onInput
  }

  stop(): void {
    this.started = false
    this.input = null
  }

  drainInput(): Promise<void> {
    return Promise.resolve()
  }

  write(data: string): void {
    this.writes.push(data)
  }

  moveBy(_lines: number): void {}

  hideCursor(): void {}

  showCursor(): void {}

  clearLine(): void {}

  clearFromCursor(): void {}

  clearScreen(): void {}

  setTitle(_title: string): void {}

  setProgress(_active: boolean): void {}

  setProgramStatus(_status: ProgramStatus): void {}

  /**
   * Deliver raw key data to the running renderer.
   * @param data - terminal input bytes.
   */
  send(data: string): void {
    if (this.input === null) throw new Error('the fake terminal is not started')
    this.input(data)
  }

  /**
   * Render the recorded output as visible text lines, without escape sequences.
   * @returns one entry per rendered line.
   */
  visibleLines(): string[] {
    return stripTerminalSequences(this.writes.join(''))
      .split('\r\n')
      .map(line => line.replace(/\r/g, ''))
  }

  /** Drop recorded output so the next frame is inspected alone. */
  reset(): void {
    this.writes.length = 0
  }
}
