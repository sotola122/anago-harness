/**
 * Fork profile layers and the Node egress guard.
 *
 * Importing this module installs the guard in the current process.
 * @module @anago-harness/fork-policy
 */

import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

/** Hostname decision exposed by the installed egress guard. */
export interface EgressGuard {
  /**
   * Decide whether a hostname is denied.
   * @param host - Raw host from a connect, lookup, or proxy target.
   * @returns A reason string when the host is denied, otherwise `undefined`.
   */
  verdict(host: string): string | undefined
  /**
   * Normalize a host the way the denylist matches it.
   * @param host - Raw host text.
   * @returns The ASCII hostname used for matching.
   */
  normalize(host: string): string
}

interface GuardModule {
  readonly guard: EgressGuard
}

// oxlint-disable-next-line typescript/no-unsafe-assignment -- createRequire is typed any; egress-guard.cjs exports the installed guard
const guardModule: GuardModule = require(fileURLToPath(new URL('../egress-guard.cjs', import.meta.url)))

/** Installed egress guard. Evaluating this binding installs the denylist. */
export const guard: EgressGuard = guardModule.guard

/**
 * Fork profile patches applied with the bundle layers.
 * The current list is empty.
 * @param entries - Composed bundle rows supplied by the boot composer.
 * @returns No patches.
 */
export function forkDefaultPatches(entries: readonly unknown[]): readonly never[] {
  void entries
  return []
}

/**
 * Fork profile patches applied after every other layer.
 * The current list is empty.
 * @param entries - Composed rows present before this final layer.
 * @returns No patches.
 */
export function forkLockPatches(entries: readonly unknown[]): readonly never[] {
  void entries
  return []
}
