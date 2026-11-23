import type { Grade, WorkProject } from '@/lib/host/index.ts'

/** Which projects the main Work screen lists, and which wait in discovery. Presentation only: no project changes state. */

/** A priority's place, the most pressing first. */
export const GRADE_ORDER: Record<Grade, number> = { P0: 0, P1: 1, P2: 2, P3: 3 }

/** Projects hobkin works on, paused ones included, by priority and then in hobkin's order. */
export function trackedProjects(projects: readonly WorkProject[]): WorkProject[] {
  return projects.filter(({ state }) => state === 'chosen').sort((a, b) => GRADE_ORDER[a.priority] - GRADE_ORDER[b.priority])
}

const DISCOVERY_ORDER: Record<string, number> = {
  proposed: 0,
  skipped: 1,
  dropped: 2,
}

/** Projects hobkin knows and does not work on: proposals first, then skipped, then dropped, each in hobkin's order. */
export function discoverableProjects(projects: readonly WorkProject[]): WorkProject[] {
  return projects.filter(({ state }) => state !== 'chosen').sort((a, b) => (DISCOVERY_ORDER[a.state] ?? 3) - (DISCOVERY_ORDER[b.state] ?? 3))
}
