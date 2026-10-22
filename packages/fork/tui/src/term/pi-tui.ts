/**
 * Single join point for the pi terminal UI dependency. Every other module in
 * this package imports the library through this file, so an upgrade needs one
 * specifier change and one lockfile update.
 * @module @anago-harness/tui/term/pi-tui
 */

export * from '@earendil-works/pi-tui'
