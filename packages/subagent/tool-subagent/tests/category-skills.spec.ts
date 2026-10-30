import { describe, expect, it } from 'vitest'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { categorySkillDirective } from '../src/category-skills.ts'
import type { PurposeRoute, PurposeRouteTable } from '../src/purpose-routing.ts'
import { callSubagent, setup } from './harness.ts'
import { MockAdapter } from '../../../core/agent-loop/tests/mock-adapter.ts'

const EFFORT = ReasoningEffortId('high')

function route(provider: string, model: string): PurposeRoute {
  return { provider, model, reasoningEffort: EFFORT }
}

function table(): PurposeRouteTable {
  const one = (provider: string, model: string) => [route(provider, model)]
  return {
    light: one('alpha', 'light-model'),
    medium: one('alpha', 'medium-model'),
    deep: one('alpha', 'deep-model'),
    review: one('alpha', 'review-model'),
    writing: one('beta', 'writer'),
    default: one('gamma', 'general'),
  }
}

const REASONING = {
  efforts: [{ id: EFFORT, name: EFFORT }],
  defaultEffort: EFFORT,
} as const

function registerRoutes(ctx: Awaited<ReturnType<typeof setup>>): void {
  for (const provider of ['alpha', 'beta', 'gamma']) {
    ctx.llm.registerAdapter([provider], new MockAdapter([], REASONING))
  }
}

function taskText(request: SubagentStartRequest): string {
  return request.prompt.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
}

describe('category skill directive', () => {
  it('uses skill and it for one name, and skills and them for several', () => {
    expect(categorySkillDirective(['yomiyasu'])).toBe(
      'Before you write, load the yomiyasu skill with the skill tool and follow it.',
    )
    expect(categorySkillDirective(['alpha', 'beta'])).toBe(
      'Before you write, load the alpha and beta skills with the skill tool and follow them.',
    )
    expect(categorySkillDirective(['alpha', 'beta', 'gamma'])).toBe(
      'Before you write, load the alpha, beta, and gamma skills with the skill tool and follow them.',
    )
  })

  it('prepends the writing sentence once and leaves a category without skills unchanged', async () => {
    const prompts: string[] = []
    const ctx = await setup({
      provider: 'mock',
      purposeRouting: true,
      purposeRoutes: table(),
      categorySkills: { writing: ['yomiyasu'] },
    }, {
      onStart: (request) => { prompts.push(taskText(request)) },
    })
    registerRoutes(ctx)
    const writing = await callSubagent(ctx, { description: 'write', prompt: 'draft the note', category: 'writing' })
    const review = await callSubagent(ctx, { description: 'review', prompt: 'review it', category: 'review' })
    const omitted = await callSubagent(ctx, { description: 'general', prompt: 'do it' })
    expect(writing.isError).toBe(false)
    expect(review.isError).toBe(false)
    expect(omitted.isError).toBe(false)
    expect(prompts).toEqual([
      'Before you write, load the yomiyasu skill with the skill tool and follow it.\ndraft the note',
      'review it',
      'do it',
    ])
    expect(prompts[0]?.match(/Before you write/g)).toEqual(['Before you write'])
  })

  it('renders a multi-name list with skills and them', async () => {
    const prompts: string[] = []
    const ctx = await setup({
      provider: 'mock',
      purposeRouting: true,
      purposeRoutes: table(),
      categorySkills: { writing: ['alpha', 'beta', 'gamma'] },
    }, {
      onStart: (request) => { prompts.push(taskText(request)) },
    })
    registerRoutes(ctx)
    const result = await callSubagent(ctx, { description: 'write', prompt: 'draft the note', category: 'writing' })
    expect(result.isError).toBe(false)
    expect(prompts).toEqual([
      'Before you write, load the alpha, beta, and gamma skills with the skill tool and follow them.\ndraft the note',
    ])
  })

  it('leaves the prompt unchanged when purpose routing is off', async () => {
    const prompts: string[] = []
    const ctx = await setup({
      provider: 'mock',
      categorySkills: { writing: ['yomiyasu'] },
    }, {
      onStart: (request) => { prompts.push(taskText(request)) },
    })
    const result = await callSubagent(ctx, { description: 'work', prompt: 'do it' })
    expect(result.isError).toBe(false)
    expect(prompts).toEqual(['do it'])
  })

  it('rejects an unknown key and a blank name at load', async () => {
    await expect(setup({
      provider: 'mock',
      categorySkills: { default: ['yomiyasu'] },
    })).rejects.toThrow('tool-subagent: categorySkills key "default" is not a purpose category')
    await expect(setup({
      provider: 'mock',
      categorySkills: { writing: [''] },
    })).rejects.toThrow('tool-subagent: categorySkills name "" is blank')
    await expect(setup({
      provider: 'mock',
      categorySkills: { writing: ['  \t'] },
    })).rejects.toThrow('tool-subagent: categorySkills name "  \\t" is blank')
  })
})
