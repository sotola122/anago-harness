import { describe, expect, it } from 'vitest'
import { StatusView } from '../src/app/status.ts'
import { themeFor } from '../src/app/theme.ts'
import { EMPTY_USAGE } from '../src/projection/usage.ts'

/** Dark theme shared by these tests. */
const THEME = themeFor('dark')

/**
 * Build one footer with the fields these tests vary.
 * @param overrides - fields replacing the idle defaults.
 * @returns the footer facts.
 */
function fields(overrides: Partial<Parameters<StatusView['setFields']>[0]> = {}): Parameters<StatusView['setFields']>[0] {
  return {
    model: '',
    provider: '',
    sessionId: '',
    status: 'idle',
    hint: '',
    usage: EMPTY_USAGE,
    ...overrides,
  }
}

describe('footer status line', () => {
  it('shows pending until a route is known', () => {
    const view = new StatusView(THEME, fields())

    expect(view.getFields().status).toBe('idle')
    expect(view.render(80).join('')).toContain('model pending')
    expect(view.render(80).join('')).toContain('idle')
  })

  it('shows the route, usage, Session, and transient hint', () => {
    const view = new StatusView(THEME, fields({
      provider: 'deepseek',
      model: 'deepseek-v4',
      sessionId: '0123456789abcdef',
      status: 'running',
      hint: 'Ctrl+C again to quit',
      usage: { inputTokens: 1_200, outputTokens: 300, reasoningTokens: 0, requests: 1 },
    }))

    const line = view.render(120).join('')

    expect(line).toContain('deepseek · deepseek-v4')
    expect(line).toContain('running')
    expect(line).toContain('in 1.2k · out 300')
    expect(line).toContain('session 01234567')
    expect(line).toContain('Ctrl+C again to quit')
  })

  it('replaces the displayed facts and tolerates a redraw request', () => {
    const view = new StatusView(THEME, fields())
    view.setFields(fields({ model: 'deepseek-v4' }))
    view.invalidate()

    expect(view.getFields().model).toBe('deepseek-v4')
    expect(view.render(80).join('')).toContain('deepseek-v4')
  })
})
