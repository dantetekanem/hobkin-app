import type { RoutineFacts } from './rules.ts'
import type { SkyMark } from './sky-math.ts'

/** An explicit disclosure choice lasts for the mounted view; otherwise use its visible activity. */
export function groupExpanded(
  group: readonly RoutineFacts[],
  marks: readonly Pick<SkyMark, 'routineId' | 'kind'>[],
  chosen?: boolean,
): boolean {
  return chosen ?? group.some((item) => item.state === 'running' || marks.some((mark) => mark.routineId === item.routine.id))
}
