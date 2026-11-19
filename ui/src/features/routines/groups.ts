import type { RoutineFacts } from './rules.ts'
import type { SkyMark } from './sky-math.ts'
import { RECURRENCES, type Recurrence, type Routine } from './types.ts'

/**
 * The group a routine is listed in, and walked by the keyboard. It is its folder's cadence, except that a weekly
 * routine that runs exactly Monday to Friday goes with the daily ones. Its file stays in the weekly folder.
 */
export function groupOf({ cadence, weekday }: Pick<Routine, 'cadence' | 'weekday'>): Recurrence {
  if (cadence !== 'weekly') return cadence
  const days = new Set([weekday].flat())
  return days.size === 5 && [1, 2, 3, 4, 5].every((day) => days.has(day)) ? 'daily' : 'weekly'
}

/** Each group the user opened (true) or folded (false). A group left out follows what is due. */
export type GroupChoices = Partial<Record<Recurrence, boolean>>

/** The choices kept in storage: only the screen's own groups, each open or folded. Anything else there is ignored. */
export function groupChoices(stored: unknown): GroupChoices {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return {}
  const choices: GroupChoices = {}
  for (const group of RECURRENCES) {
    const choice = (stored as Record<string, unknown>)[group]
    if (typeof choice === 'boolean') choices[group] = choice
  }
  return choices
}

/** An explicit disclosure choice lasts for the mounted view; otherwise use its visible activity. */
export function groupExpanded(
  group: readonly RoutineFacts[],
  marks: readonly Pick<SkyMark, 'routineId' | 'kind'>[],
  chosen?: boolean,
): boolean {
  return chosen ?? group.some((item) => item.state === 'running' || marks.some((mark) => mark.routineId === item.routine.id))
}
