import type { FinishedChange, StackPlace } from '#shared/protocol/work.ts'
import { timeOf, waited } from '../reports/time.ts'

/**
 * What a finished change's row says (_specs/061-finished-changes-rows). Pure, so it is tested without a window: the
 * facts line's parts in order and what a key does on the row. Its sentence, tags and action are in `change-list.ts`.
 */

/** Where a pull request stands on GitHub, as far as a row says it. */
export interface PullFacts {
  review: 'approved' | 'changes-requested' | 'waiting' | 'none'
  checks: 'passing' | 'failing' | 'pending' | 'none'
  draft: boolean
}

export type Tone = 'ok' | 'bad' | 'quiet'

/** One part of the facts line. A part with nothing to say is not in the list, so the rest keep their order. */
export type Fact =
  | { kind: 'project'; text: string }
  | { kind: 'issue' }
  | { kind: 'size'; text: string }
  | { kind: 'behind'; text: string }
  | { kind: 'pull-state'; text: string; tone: Tone }
  | { kind: 'pull' }
  | { kind: 'models'; text: string }

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

const REVIEW_WORDS: Record<PullFacts['review'], { text: string; tone: Tone } | null> = {
  approved: { text: 'Approved', tone: 'ok' },
  'changes-requested': { text: 'Changes requested', tone: 'bad' },
  waiting: { text: 'Waiting for review', tone: 'quiet' },
  none: null,
}
const CHECK_WORDS: Record<PullFacts['checks'], { text: string; tone: Tone } | null> = {
  passing: { text: 'Checks pass', tone: 'ok' },
  failing: { text: 'Checks fail', tone: 'bad' },
  pending: { text: 'Checks running', tone: 'quiet' },
  none: null,
}

/** The facts line: project, issue, size, how far behind, the pull request's state and link, and the model checks as one count. */
export function factsOf(change: Pick<FinishedChange, 'project' | 'issue' | 'size' | 'behind' | 'pr' | 'models'>, pull?: PullFacts): Fact[] {
  const facts: Fact[] = [{ kind: 'project', text: change.project }]
  if (change.issue) facts.push({ kind: 'issue' })
  if (change.size) facts.push({ kind: 'size', text: `${plural(change.size.lines, 'line')} · ${plural(change.size.files, 'file')}` })
  if (change.behind > 0) facts.push({ kind: 'behind', text: `${change.behind} behind` })
  const states = [REVIEW_WORDS[pull?.review ?? 'none'], CHECK_WORDS[pull?.checks ?? 'none'], pull?.draft ? { text: 'Draft', tone: 'quiet' as const } : null]
  for (const state of states) if (state) facts.push({ kind: 'pull-state', ...state })
  if (change.pr) facts.push({ kind: 'pull' })
  if (change.models?.length) facts.push({ kind: 'models', text: plural(change.models.length, 'model check') })
  return facts
}

/** "1 of 5", before a layer's title. */
export const placeBefore = (stack: StackPlace | null | undefined): string | null => (stack ? `${stack.layer} of ${stack.of}` : null)

/** What a key does on a row that has the keyboard. Only the row itself answers: a key in its reply box, or on a control, is that control's. */
export type RowKey = 'review' | 'toggle' | null

export function rowKey({ key, onRow }: { key: string; onRow: boolean }): RowKey {
  if (!onRow) return null
  if (key === 'Enter') return 'review'
  if (key === ' ') return 'toggle'
  return null
}

/** How long ago a change was written, "a moment ago", "5 minutes ago" or "2 days ago", from its `at`. Null when it has no readable time. */
export function whenWords(at: string | undefined, now: number): string | null {
  const written = timeOf(at)
  return written === null ? null : `${waited(written, now)} ago`
}
