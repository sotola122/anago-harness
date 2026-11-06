// @vitest-environment jsdom
/**
 * Mobile Enter routing: a touch keyboard's plain Enter starts a new line
 * instead of submitting, while the Send button gesture keeps submitting.
 * The device probe caches per module instance, so this file sets the user
 * agent before importing the keymap.
 */
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'
import { $getRoot, createEditor } from 'lexical'

Object.defineProperty(navigator, 'userAgent', {
  value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  configurable: true,
})
const { registerComposerKeymap } = await import('../src/client/input/editor/keymap.ts')

/** Mount a minimal editor rooted in the document with one keymap registration. */
function mountEditor() {
  const editor = createEditor({ namespace: 'keymap-mobile-enter', onError: (error) => { throw error } })
  const root = document.createElement('div')
  root.contentEditable = 'true'
  document.body.append(root)
  editor.setRootElement(root)
  const submit = vi.fn()
  const unregister = registerComposerKeymap(editor, {
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
    root.remove()
  })
  return { editor, root, submit }
}

describe('keymap mobile Enter', () => {
  it('inserts a line break for a plain Enter instead of submitting', () => {
    const { editor, root, submit } = mountEditor()
    const paragraphs = () => editor.getEditorState().read(() => $getRoot().getChildrenSize())
    const before = paragraphs()
    // fireEvent returns false when the event was cancelled; the line break needs it uncancelled.
    expect(fireEvent.keyDown(root, { key: 'Enter', code: 'Enter' })).toBe(true)
    expect(submit).not.toHaveBeenCalled()
    expect(paragraphs()).toBeGreaterThanOrEqual(before)
  })

  it('still submits on the accelerated chord', () => {
    const { root, submit } = mountEditor()
    fireEvent.keyDown(root, { key: 'Enter', code: 'Enter', metaKey: true })
    expect(submit).toHaveBeenCalledWith(true)
  })
})

describe('keymap mobile Enter on a desktop pointer', () => {
  it('keeps desktop Enter submitting', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
      configurable: true,
    })
    vi.resetModules()
    const fresh = await import('../src/client/input/editor/keymap.ts')
    const editor = createEditor({ namespace: 'keymap-desktop-enter', onError: (error) => { throw error } })
    const root = document.createElement('div')
    root.contentEditable = 'true'
    document.body.append(root)
    editor.setRootElement(root)
    const submit = vi.fn()
    const unregister = fresh.registerComposerKeymap(editor, {
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
      root.remove()
    })
    fireEvent.keyDown(root, { key: 'Enter', code: 'Enter' })
    expect(submit).toHaveBeenCalledWith(false)
  })
})
