/**
 * Standalone in-memory terminal for boot tests.
 *
 * It deliberately imports nothing from the package: the boot spec mocks
 * `src/term/pi-tui.ts`, and a fake that imported it would load the mock's own
 * dependency while the mock factory is still running.
 * @module @anago-harness/tui/tests/support/boot-terminal
 */

/** One recorded terminal session. */
export class BootTerminal {
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

  setProgramStatus(_status: string): void {}

  /**
   * Deliver raw key data to the running renderer.
   * @param data - terminal input bytes.
   */
  send(data: string): void {
    if (this.input === null) throw new Error('the boot terminal is not started')
    this.input(data)
  }

  /**
   * Recorded output with terminal control sequences removed.
   * @returns the visible transcript of writes.
   */
  visibleText(): string {
    return this.writes.join('').replace(/\x1b\[[0-9;?]*[A-Za-z]/gu, '')
  }
}
