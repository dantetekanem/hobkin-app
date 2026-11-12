import type { AssessmentStatus } from '#shared/review/assessment.ts'
import type { PrepareState } from '#shared/review/status.ts'

/**
 * The AI Reviews tab's data: every review the host knows, sorted into what is running, what is ready and what failed.
 * The shape is the host's `review.list` result, newest first. Pure, so it is tested without a window.
 */

export interface ReviewListItem {
  id: string
  kind: 'change' | 'pull'
  title: string
  project: string
  head: string | null
  /** How the review itself (its graph) stands. */
  state: PrepareState
  phase: string | null
  assessment?: AssessmentStatus
  error?: string | null
  /** An ISO time. */
  updatedAt: string
}
export interface ReviewList {
  reviews: ReviewListItem[]
}
export type ReviewGroup = 'running' | 'ready' | 'failed'
export interface ReviewRow {
  item: ReviewListItem
  group: ReviewGroup
  /** What it is doing now, for a running one; why it stopped, for a failed one. */
  line: string
  percent: number | null
}

const PHASES: Record<string, string> = { queued: 'Waiting its turn', reading: 'Reading the change', arranging: 'Arranging the story', checking: 'Checking the result' }

export function groupOf(item: ReviewListItem): ReviewGroup {
  const assessment = item.assessment?.state
  if (item.state === 'failed' || assessment === 'failed') return 'failed'
  if (item.state === 'preparing' || assessment === 'queued' || assessment === 'running') return 'running'
  return 'ready'
}

export function rowOf(item: ReviewListItem): ReviewRow {
  const group = groupOf(item)
  const assessment = item.assessment
  let line = ''
  if (group === 'failed') {
    line = assessment?.error ?? item.error ?? 'It stopped.'
  } else if (group === 'running') {
    const waiting = assessment?.state === 'queued' ? 'Waiting its turn' : 'Starting'
    line = assessment?.now ?? (item.phase ? PHASES[item.phase] : null) ?? waiting
  }
  const percent = group === 'running' && assessment?.percent != null ? Math.round(assessment.percent) : null
  return { item, group, line, percent }
}

/** Running first, then ready, then failed, each as the host sent them (newest first). */
export function groupReviews(list: ReviewList | null): { running: ReviewRow[]; ready: ReviewRow[]; failed: ReviewRow[] } {
  const out = { running: [] as ReviewRow[], ready: [] as ReviewRow[], failed: [] as ReviewRow[] }
  for (const item of list?.reviews ?? []) {
    const row = rowOf(item)
    out[row.group].push(row)
  }
  return out
}

/** "3 min ago", from an ISO time. */
export function agoWords(iso: string, now: number): string {
  const seconds = Math.max(0, (now - Date.parse(iso)) / 1000)
  if (!Number.isFinite(seconds)) return ''
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`
  return `${Math.floor(seconds / 86400)} d ago`
}

/** Shown without a host. */
export const SAMPLE_REVIEWS: ReviewList = {
  reviews: [
    { id: 'change:hobkin:sample-1', kind: 'change', title: 'Sample: reading the change', project: 'hobkin', head: 'abc1234', state: 'ready', phase: 'reading', assessment: { state: 'running', head: 'abc1234', percent: 40, now: 'Mapping the changed definitions' }, updatedAt: new Date().toISOString() },
    { id: 'pr:acme/web/12', kind: 'pull', title: 'Sample: tighten the login form', project: 'acme/web', head: 'def5678', state: 'ready', phase: null, assessment: { state: 'ready', head: 'def5678', summary: { level: 'mid', critical: false, needsYou: 0, worthALook: 2, safe: 3, storyBy: 'model', at: new Date(Date.now() - 3_600_000).toISOString() } }, updatedAt: new Date(Date.now() - 3_600_000).toISOString() },
  ],
}
