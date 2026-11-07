// @vitest-environment jsdom
/**
 * Mobile Enter routing: a touch keyboard's plain Enter starts a new line
 * instead of submitting, while the Send button gesture keeps submitting.
 * The device probe caches per module instance, so this file sets the user
 * agent before importing the keymap.
 */
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'
import { COMMAND_PRIORITY_EDITOR, createEditor, KEY_ENTER_COMMAND } from 'lexical'

Object.defineProperty(navigator, 'userAgent', {
  value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  configurable: true,
})
const { registerComposerKeymap } = await import('../src/client/input/editor/keymap.ts')

/**
 * Mount a minimal editor rooted in the document with one keymap registration.
 * `lineBreak` stands in for Lexical's own Enter handler, which runs only when the keymap declines the key.
 */
function mountEditor(register: typeof registerComposerKeymap = registerComposerKeymap) {
  const editor = createEditor({ namespace: 'keymap-mobile-enter', onError: (error) => { throw error } })
  const root = document.createElement('div')
  root.contentEditable = 'true'
  document.body.append(root)
  editor.setRootElement(root)
  const submit = vi.fn()
  const lineBreak = vi.fn(() => true)
  const unregisterLineBreak = editor.registerCommand(KEY_ENTER_COMMAND, lineBreak, COMMAND_PRIORITY_EDITOR)
  const unregister = register(editor, {
    arbitrate: () => 'pass',
    space: () => false,
    dismissPopup: () => {},
    canSubmit: () => true,
    submit,
    intakeFiles: () => {},
    pasteText: () => {},
  })
  onTestFinished(() => {
    unregister()
    unregisterLineBreak()
    root.remove()
  })
  return { editor, root, submit, lineBreak }
}

describe('keymap mobile Enter', () => {
  it('leaves a plain Enter to the line-break handler instead of submitting', () => {
    const { root, submit, lineBreak } = mountEditor()
    // fireEvent returns false when the event was cancelled; the line break needs it uncancelled.
    expect(fireEvent.keyDown(root, { key: 'Enter', code: 'Enter' })).toBe(true)
    expect(lineBreak).toHaveBeenCalledOnce()
    expect(submit).not.toHaveBeenCalled()
  })

  it('leaves the eventless Enter of a composition ending on a line break to the same handler', () => {
    const { editor, submit, lineBreak } = mountEditor()
    editor.dispatchCommand(KEY_ENTER_COMMAND, null)
    expect(lineBreak).toHaveBeenCalledOnce()
    expect(submit).not.toHaveBeenCalled()
  })

  it('still submits on the accelerated chord', () => {
    const { root, submit, lineBreak } = mountEditor()
    fireEvent.keyDown(root, { key: 'Enter', code: 'Enter', metaKey: true })
    expect(submit).toHaveBeenCalledWith(true)
    expect(lineBreak).not.toHaveBeenCalled()
  })
})

describe('keymap mobile Enter on a desktop pointer', () => {
  it('keeps desktop Enter submitting, with or without a key event', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
      configurable: true,
    })
    vi.resetModules()
    const fresh = await import('../src/client/input/editor/keymap.ts')
    const { editor, root, submit, lineBreak } = mountEditor(fresh.registerComposerKeymap)
    fireEvent.keyDown(root, { key: 'Enter', code: 'Enter' })
    expect(submit).toHaveBeenCalledTimes(1)
    editor.dispatchCommand(KEY_ENTER_COMMAND, null)
    expect(submit).toHaveBeenCalledTimes(2)
    expect(submit).toHaveBeenCalledWith(false)
    expect(lineBreak).not.toHaveBeenCalled()
  })
})
