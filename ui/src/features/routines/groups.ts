import type { RoutineFacts } from './rules.ts'
import type { SkyMark } from './sky-math.ts'
import type { Recurrence, Routine } from './types.ts'

/**
 * The group a routine is listed in, and walked by the keyboard. It is its folder's cadence, except that a weekly
 * routine that runs exactly Monday to Friday goes with the daily ones. Its file stays in the weekly folder.
 */
export function groupOf({ cadence, weekday }: Pick<Routine, 'cadence' | 'weekday'>): Recurrence {
  if (cadence !== 'weekly') return cadence
  const days = new Set([weekday].flat())
  return days.size === 5 && [1, 2, 3, 4, 5].every((day) => days.has(day)) ? 'daily' : 'weekly'
}

/** An explicit disclosure choice lasts for the mounted view; otherwise use its visible activity. */
export function groupExpanded(
  group: readonly RoutineFacts[],
  marks: readonly Pick<SkyMark, 'routineId' | 'kind'>[],
  chosen?: boolean,
): boolean {
  return chosen ?? group.some((item) => item.state === 'running' || marks.some((mark) => mark.routineId === item.routine.id))
}
