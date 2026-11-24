import type { Grade, WorkProject } from '@/lib/host/index.ts'
import { timeOf, waited } from '../reports/time.ts'

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

/** A project with no kind is code, as every project from before goals is. */
export const isGoal = (project: Pick<WorkProject, 'kind'>): boolean => project.kind === 'goal'

const plural = (amount: number, one: string, many = `${one}s`) => `${amount} ${amount === 1 ? one : many}`

/**
 * What a project has going, as the terminal's Work tab says it (`projectStatus` in hobkin's `src/cli/ui.mjs`). A goal says
 * Goal, then its steps to do, done and left for the user, always: it has no pull requests or branches to count.
 */
export function projectFacts(project: WorkProject, now: number): string {
  const next = timeOf(project.nextLookAt)
  const later = next !== null && next > now ? `next look in ${waited(now, next)}` : ''
  if (isGoal(project)) {
    return ['Goal', project.level, `${project.open} to do`, `${project.done ?? 0} done`, `${project.left} left for you`, later].filter(Boolean).join(' · ')
  }
  const facts = [
    project.open ? plural(project.open, 'item') : '',
    project.prs ? plural(project.prs, 'PR') : '',
    project.branches ? plural(project.branches, 'branch', 'branches') : '',
    project.left ? `${project.left} left for you` : '',
    project.unmerged ? `${project.unmerged} unmerged` : '',
    later,
  ].filter(Boolean)
  return [project.level, ...(facts.length ? facts : ['not looked at yet'])].join(' · ')
}
