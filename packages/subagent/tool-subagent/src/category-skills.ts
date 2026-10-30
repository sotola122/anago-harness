/**
 * Purpose-category skill names and the one sentence prepended to a child prompt.
 * `default` is a route-table slot, not a key of this mapping.
 * @module @deepseek-ai/dsh-tool-subagent/category-skills
 */

import { isPurposeCategory } from './purpose-routing.ts'
import type { PurposeCategory } from './purpose-routing.ts'

/** Skill names keyed by a purpose category. An omitted config field is empty. */
export type CategorySkills = { readonly [C in PurposeCategory]?: readonly string[] }

/**
 * Reject a key outside the five purpose categories and a blank skill name.
 * An omitted mapping is empty. An empty list is kept and prepends nothing.
 * @param value - the `categorySkills` field, or undefined when direct apply omitted it.
 * @returns the mapping used when a category is resolved.
 * @throws when a key is not a purpose category, or a name is empty or whitespace-only. The message names that key or name.
 */
export function assertCategorySkills(
  value: Readonly<Record<string, readonly string[]>> | undefined,
): CategorySkills {
  if (value === undefined) return {}
  const skills: { [C in PurposeCategory]?: readonly string[] } = {}
  for (const key of Object.keys(value)) {
    if (!isPurposeCategory(key)) {
      throw new Error(`tool-subagent: categorySkills key ${JSON.stringify(key)} is not a purpose category`)
    }
    const names = value[key] ?? []
    for (const name of names) {
      if (name.trim().length === 0) {
        throw new Error(`tool-subagent: categorySkills name ${JSON.stringify(name)} is blank`)
      }
    }
    skills[key] = names
  }
  return skills
}

/**
 * Join skill names with commas and a final `and`.
 * Two names use `and` with no comma. Three or more use a comma before `and`.
 * @param names - non-empty names, in config order.
 * @returns the name list inside the directive sentence.
 */
function joinSkillNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
}

/**
 * The one sentence a child reads before the parent prompt.
 * One name uses `skill` and `it`. More than one uses `skills` and `them`.
 * @param names - non-empty skill names already accepted at load.
 * @returns the sentence, with no trailing newline.
 */
export function categorySkillDirective(names: readonly string[]): string {
  const listed = joinSkillNames(names)
  if (names.length > 1) {
    return `Before you write, load the ${listed} skills with the skill tool and follow them.`
  }
  return `Before you write, load the ${listed} skill with the skill tool and follow it.`
}

/**
 * Prepend {@link categorySkillDirective} when the resolved category has names.
 * Every other call returns `prompt` unchanged.
 * @param prompt - the parent-supplied child task.
 * @param category - the purpose category purpose routing resolved, or undefined when the call did not select one.
 * @param skills - the load-validated mapping. Undefined is empty.
 * @returns the child task text.
 */
export function promptWithCategorySkills(
  prompt: string,
  category: PurposeCategory | undefined,
  skills: CategorySkills | undefined,
): string {
  if (category === undefined || skills === undefined) return prompt
  const names = skills[category]
  if (names === undefined || names.length === 0) return prompt
  return `${categorySkillDirective(names)}\n${prompt}`
}
