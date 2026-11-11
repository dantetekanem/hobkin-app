import type { WorkState } from '#shared/protocol/work.ts'
import type { HostState } from '../../lib/host/state.ts'
import { toneOf, type Report, type Tone } from './report.ts'

export const AGED_REPORT_MS = 7 * 24 * 60 * 60 * 1000
export interface HomeIdea {
  id: string
  kind: 'report' | 'review' | 'proposal'
  sourceId: string
  title: string
  detail: string
  tone: Tone
  aged: boolean
  age: number | null
}

export function reportAge(report: Report, now: number): number | null {
  const at = report.at ? Date.parse(report.at) : NaN
  return Number.isFinite(at) && at <= now ? now - at : null
}

/** No current protocol field proves reset readiness AND Hobkin-owned child coverage. */
export function activityOf(state: Pick<HostState, 'question' | 'work'>) {
  return { state: 'unknown' as const, waiting: state.question !== null, held: state.work?.held ?? null }
}

/** Navigation only: never a work command, model call, read acknowledgment or shipping instruction. */
export function ideaTarget(idea: HomeIdea): { page: 'reports'; reportId: string } | { page: 'work' } {
  return idea.kind === 'report' ? { page: 'reports', reportId: idea.sourceId } : { page: 'work' }
}

/** Rank observed evidence, not inferred resolution. Read marks and age never demote critical/blocked. */
export function homeIdeas(list: readonly Report[], read: ReadonlySet<string>, work: WorkState | null, now: number, limit = 4): HomeIdea[] {
  const rows: { idea: HomeIdea; rank: number }[] = list.map((report) => {
    const tone = toneOf(report)
    const age = reportAge(report, now)
    const aged = age !== null && age >= AGED_REPORT_MS
    const rank = tone === 'critical' ? 0 : tone === 'blocked' ? 1 : tone === 'nothing' ? 8 : aged ? 7 : read.has(report.id) ? 6 : 5
    return { rank, idea: { id: `report:${report.id}`, sourceId: report.id, kind: 'report', title: report.title, tone, aged, age, detail: `${tone === 'plain' ? 'Unclassified' : tone} report · ${read.has(report.id) ? 'read' : 'unread'}` } }
  })
  for (const group of work?.finished ?? []) {
    for (const change of group.changes) rows.push({ rank: 2, idea: { id: `change:${change.key}`, sourceId: change.key, kind: 'review', title: change.title, detail: `Review work · ${change.project}`, tone: 'plain', age: null, aged: false } })
  }
  for (const project of work?.projects ?? []) {
    if (project.state === 'proposed') rows.push({ rank: 3, idea: { id: `project:${project.slug}`, sourceId: project.slug, kind: 'proposal', title: project.name, detail: 'Consider this proposed project', tone: 'useful', age: null, aged: false } })
  }
  // Stable sort preserves the host's order within a class. No timestamp implies validity or obsolescence.
  return rows.sort((a, b) => a.rank - b.rank).slice(0, Math.max(0, limit)).map(({ idea }) => idea)
}
