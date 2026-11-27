import type { ChangeChoice, FinishedChange, FinishedGroup, YoloState } from '#shared/protocol/work.ts'
import type { PullFacts } from './change-row.ts'
import { GRADE_ORDER } from './projects.ts'
import { arrange, type Entry } from './stacks.ts'

/**
 * Work's finished changes as one list (_specs/066-work-one-list). The host still sends hobkin's groups; the window
 * flattens them here and nothing more. Pure, so it is tested without a window: the entries, their order, their cut by
 * project, and for each change its grades, its sentence, its tags and its one action.
 */

/** The lowest general rate a change may have for Merge when the window knows no other. */
export const DEFAULT_LOWEST = 8

/** A change with more lines than this is large: it says so, and Change Review offers to make it a stack. */
export const LARGE_LINES = 300

/** A change's size in words: "1 line", "12 lines", "1,200 lines". */
export const linesOf = (lines: number): string => `${lines.toLocaleString('en-US')} ${lines === 1 ? 'line' : 'lines'}`


/** The lowest rate as a number to compare by: 8 whenever the rules gave none. */
const usable = (lowest: number | null | undefined): number => (typeof lowest === 'number' && Number.isFinite(lowest) ? lowest : DEFAULT_LOWEST)

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

/** The user's lowest rate: the YOLO rules' own number when they have one, then YOLO's, and 8 where the window has neither. */
export function lowestOf(yolo: Pick<YoloState, 'lowest' | 'rules'> | null | undefined): number {
  const own = yolo?.rules?.lowestRate
  return usable(typeof own === 'number' && Number.isFinite(own) ? own : yolo?.lowest)
}

// ---- The entries ------------------------------------------------------------------------------------------------

/** Every change of every group as one entry, in the host's order; a stack is one entry, at its bottom layer's place. */
export const entriesOf = (groups: readonly FinishedGroup[]): Entry[] => arrange(groups).flatMap(({ entries }) => entries)

/** The changes of an entry: a stack's layers bottom first, or the one change. */
export const changesOf = (entry: Entry): FinishedChange[] => (entry.kind === 'stack' ? entry.layers.map(({ change }) => change) : [entry.at.change])

/** The change that stands for the entry: a stack's bottom layer, which lands first. */
export const frontOf = (entry: Entry): FinishedChange => (entry.kind === 'stack' ? entry.layers[0]!.change : entry.at.change)

export const rateOf = (change: Pick<FinishedChange, 'scoring'>): number | null => change.scoring?.rate ?? null

// ---- The order --------------------------------------------------------------------------------------------------

export type Order = 'easiest' | 'priority' | 'grade' | 'oldest' | 'smallest'

export const ORDERS: readonly { order: Order; label: string }[] = [
  { order: 'easiest', label: 'Easiest first' },
  { order: 'priority', label: 'Priority' },
  { order: 'grade', label: 'Best grade' },
  { order: 'oldest', label: 'Oldest' },
  { order: 'smallest', label: 'Smallest' },
]
export const DEFAULT_ORDER: Order = 'easiest'

const LAST = Number.MAX_SAFE_INTEGER
type Key = readonly number[]

function compare(a: Key, b: Key): number {
  const at = a.findIndex((value, place) => value !== b[place])
  return at < 0 ? 0 : a[at]! - b[at]!
}

/** What an entry is measured by: a stack takes its bottom layer's rate, its best priority, its oldest time and all its lines. */
function measure(entry: Entry) {
  const changes = changesOf(entry)
  const rate = rateOf(frontOf(entry))
  const priority = Math.min(...changes.map(({ grade }) => (grade ? GRADE_ORDER[grade] : GRADE_ORDER.P3 + 1)))
  const sizes = changes.flatMap(({ size }) => (size ? [size.lines] : []))
  const times = changes.flatMap(({ at }) => (at && !Number.isNaN(Date.parse(at)) ? [Date.parse(at)] : []))
  return {
    unrated: rate === null ? 1 : 0,
    // A higher rate sorts first. Rounded to a tenth, the way the rate is shown, so float noise is not a difference.
    worse: rate === null ? 0 : -Math.round(rate * 10),
    priority,
    lines: sizes.length ? sizes.reduce((sum, lines) => sum + lines, 0) : LAST,
    unwritten: times.length ? 0 : 1,
    written: times.length ? Math.min(...times) : 0,
  }
}

const KEYS: Record<Order, (m: ReturnType<typeof measure>) => Key> = {
  easiest: (m) => [m.unrated, m.worse, m.priority, m.lines],
  priority: (m) => [m.priority, m.unrated, m.worse],
  grade: (m) => [m.unrated, m.worse, m.priority],
  oldest: (m) => [m.unwritten, m.written],
  smallest: (m) => [m.lines],
}

/** The entries in the chosen order. A tie keeps the order given. */
export function sortEntries(entries: readonly Entry[], order: Order): Entry[] {
  const key = KEYS[order]
  return entries
    .map((entry, index) => ({ entry, key: [...key(measure(entry)), index] }))
    .sort((a, b) => compare(a.key, b.key))
    .map(({ entry }) => entry)
}

// ---- The cut by project ---------------------------------------------------------------------------------------

export interface ProjectRows {
  slug: string
  name: string
  /** How many changes it holds, every layer of a stack counted. */
  count: number
  entries: Entry[]
}

/** The entries cut by project, a project at the place of its first entry, so the order still decides what is on top. */
export function projectsOf(entries: readonly Entry[]): ProjectRows[] {
  const projects = new Map<string, ProjectRows>()
  for (const entry of entries) {
    const front = frontOf(entry)
    let own = projects.get(front.slug)
    if (!own) projects.set(front.slug, (own = { slug: front.slug, name: front.project, count: 0, entries: [] }))
    own.entries.push(entry)
    own.count += changesOf(entry).length
  }
  return [...projects.values()]
}

// ---- The grades in front --------------------------------------------------------------------------------------

export const GRADE_LABELS = ['Cover', 'Proof', 'Safe', 'Watch', 'Undo'] as const

export type GradeBlock =
  | { kind: 'graded'; rate: number; cells: { label: (typeof GRADE_LABELS)[number]; score: number | null; evidence: string }[]; /** Scored on an older commit than the change is at. */ stale: boolean }
  | { kind: 'words'; words: string }

/**
 * The block in front of a row: its rate and five grades, or two or three words that say why it has none. `review` is
 * the state of the change's review, which is what a change not scored yet is waiting on.
 */
export function gradeBlockOf(change: Pick<FinishedChange, 'scoring'>, review: string | undefined): GradeBlock {
  const { scoring } = change
  if (scoring) {
    return { kind: 'graded', rate: scoring.rate, cells: GRADE_LABELS.map((label, index) => ({ label, score: scoring.scores[index]?.score ?? null, evidence: scoring.scores[index]?.evidence ?? '' })), stale: scoring.stale }
  }
  if (review === 'running' || review === 'queued') return { kind: 'words', words: 'grading' }
  if (review === 'failed') return { kind: 'words', words: 'review failed' }
  return { kind: 'words', words: review === 'ready' ? 'not graded' : 'not reviewed' }
}

export type Tone = 'good' | 'middling' | 'low'

/** The rate reads good at the user's lowest rate or more, middling from 6, and low under that. */
export const rateTone = (rate: number, lowest: number | null | undefined): Tone => (rate >= usable(lowest) ? 'good' : rate >= 6 ? 'middling' : 'low')

/** One grade reads good from 7, middling from 5, and low under that. */
export const scoreTone = (score: number): Tone => (score >= 7 ? 'good' : score >= 5 ? 'middling' : 'low')

// ---- What stands in the way ------------------------------------------------------------------------------------

const risky = ({ safety }: Pick<FinishedChange, 'safety'>) => safety?.grade === 'risky' && !safety.stale

/** The first thing that stands between a change and its merge, in the user's words, or null. */
function wayOf(change: FinishedChange): string | null {
  if (change.conflict === true) return 'It conflicts with the default branch, so an agent has to rebase it before it can merge.'
  if (change.behind > 0) return `It is ${plural(change.behind, 'commit')} behind its base, so its code needs refreshing before it merges.`
  if (change.stack && change.stack.layer > 1) return `Layer ${change.stack.layer - 1} of its stack lands first.`
  const floor = change.scoring?.floors[0]
  if (floor) return `Its ${floor.name} is ${floor.score}, under the ${floor.needs} it needs, so it waits whatever its rate.`
  if (risky(change)) return 'Its review rates it risky to deploy.'
  return null
}

export type SentenceKind = 'note' | 'way' | 'did' | 'reason'

/** The one sentence of a row: the run's note, else what stands in the way, else what the change did, else why it waits. */
export function sentenceOf(change: FinishedChange): { kind: SentenceKind; text: string } | null {
  if (change.left) return { kind: 'note', text: change.left }
  const way = wayOf(change)
  if (way) return { kind: 'way', text: way }
  if (change.about) return { kind: 'did', text: change.about }
  return change.reason ? { kind: 'reason', text: change.reason } : null
}

export interface Tag {
  text: string
  tone: 'note' | 'bad' | 'quiet'
}

/** The small tags of a row, in order. A part a change does not have leaves no tag. */
export function tagsOf(change: FinishedChange, pull?: PullFacts): Tag[] {
  const tags: Tag[] = []
  if (change.left) tags.push({ text: 'left you a note', tone: 'note' })
  if (change.conflict === true) tags.push({ text: 'conflicts', tone: 'bad' })
  if (change.behind > 0) tags.push({ text: `${change.behind} behind`, tone: 'bad' })
  if (pull?.review === 'changes-requested') tags.push({ text: 'changes requested', tone: 'bad' })
  if (pull?.checks === 'failing') tags.push({ text: 'checks fail', tone: 'bad' })
  if (change.size && change.size.lines > LARGE_LINES) tags.push({ text: linesOf(change.size.lines), tone: 'quiet' })
  return tags
}

// ---- The one action --------------------------------------------------------------------------------------------

export type RowAction =
  | { kind: 'merge'; choice: ChangeChoice; label: string }
  | { kind: 'refresh'; choice: ChangeChoice; label: 'Refresh code' }
  | { kind: 'review'; label: 'Review' }

const REVIEW: RowAction = { kind: 'review', label: 'Review' }
const MERGES: readonly ChangeChoice[] = ['merge', 'mergePr']
const REFRESHES: readonly ChangeChoice[] = ['refreshMerge', 'rebase']

const choiceOf = (change: Pick<FinishedChange, 'choices'>, values: readonly ChangeChoice[]) => change.choices.find(({ value }) => values.includes(value))

/**
 * The one action on a closed row. Review where the run left a note. Refresh code where the change is behind or
 * conflicts and has its own way to be brought up to date. Merge, in hobkin's words, only when it is rated at the
 * user's lowest rate or more with nothing in the way. Review otherwise.
 */
export function actionOf(change: FinishedChange, lowestRate: number | null | undefined): RowAction {
  const lowest = usable(lowestRate)
  if (change.left) return REVIEW
  if (change.conflict === true || change.behind > 0) {
    const refresh = choiceOf(change, REFRESHES)
    return refresh ? { kind: 'refresh', choice: refresh.value, label: 'Refresh code' } : REVIEW
  }
  const rate = rateOf(change)
  if (rate === null || rate < lowest || change.scoring?.stale || wayOf(change)) return REVIEW
  const merge = choiceOf(change, MERGES)
  return merge ? { kind: 'merge', choice: merge.value, label: merge.label } : REVIEW
}

// ---- The tally -------------------------------------------------------------------------------------------------

export interface Tally {
  changes: number
  projects: number
  graded: number
  /** Rows whose action is Merge. */
  ready: number
}

export function tallyOf(entries: readonly Entry[], lowestRate: number | null | undefined): Tally {
  const lowest = usable(lowestRate)
  const slugs = new Set<string>()
  let changes = 0
  let graded = 0
  let ready = 0
  for (const entry of entries) {
    slugs.add(frontOf(entry).slug)
    for (const change of changesOf(entry)) {
      changes++
      if (change.scoring) graded++
    }
    if (actionOf(frontOf(entry), lowest).kind === 'merge') ready++
  }
  return { changes, projects: slugs.size, graded, ready }
}

export function tallyWords({ changes, projects, graded, ready }: Tally, lowestRate: number | null | undefined): string {
  const lowest = usable(lowestRate)
  if (changes === 0) return 'Nothing finished waits for you.'
  return `${plural(changes, 'change')} in ${plural(projects, 'project')}. ${graded} graded, ${ready} ready to merge at ${lowest} or more.`
}
