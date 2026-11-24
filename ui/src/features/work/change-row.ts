import type { ChangeChoice, FinishedChange, FinishedGroup, StackPlace } from '#shared/protocol/work.ts'

/**
 * What a finished change's row says (_specs/061-finished-changes-rows). Pure, so it is tested without a window: the
 * facts line's parts in order, the one sentence for the change's group, the one action for its group, and what a key
 * does on the row.
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

/** What kind of sentence a row leads with: the run's note, the reason a change needs the user, or what it did. */
export type SentenceKind = 'note' | 'reason' | 'did'

/**
 * The one sentence for the change's group: in "Left for you" the note its run left, in "Needs you" why it needs the
 * user, elsewhere what it did. Where the one it should be is missing, the reason stands in, since every change has one.
 */
export function sentenceOf(change: Pick<FinishedChange, 'left' | 'reason' | 'about'>, group: Pick<FinishedGroup, 'name'>): { kind: SentenceKind; text: string } | null {
  const own = ownSentence(change, group)
  if (own) return own
  return change.reason ? { kind: 'reason', text: change.reason } : null
}

function ownSentence(change: Pick<FinishedChange, 'left' | 'reason' | 'about'>, group: Pick<FinishedGroup, 'name'>): { kind: SentenceKind; text: string } | null {
  if (group.name === 'left') return change.left ? { kind: 'note', text: change.left } : null
  if (group.name === 'needs') return change.reason ? { kind: 'reason', text: change.reason } : null
  return change.about ? { kind: 'did', text: change.about } : null
}

const LANDS: readonly ChangeChoice[] = ['merge', 'mergePr', 'refreshMerge', 'rebase']

/** The one action on a closed row: Answer where a run left a note, the change's own yes where it has one, and Review otherwise. */
export type RowAction = { kind: 'answer'; label: 'Answer' } | { kind: 'yes'; choice: ChangeChoice; label: string } | { kind: 'review'; label: 'Review' }

export function actionOf(change: Pick<FinishedChange, 'choices'>, group: Pick<FinishedGroup, 'name'>): RowAction {
  if (group.name === 'left') return { kind: 'answer', label: 'Answer' }
  const yes = change.choices.find(({ value }) => LANDS.includes(value))
  if (yes) return { kind: 'yes', choice: yes.value, label: yes.label }
  return { kind: 'review', label: 'Review' }
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
