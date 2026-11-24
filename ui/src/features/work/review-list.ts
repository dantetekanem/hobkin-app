import type { NeedName } from '#shared/review/needs.ts'
import type { ReviewRow, ReviewOrder, RowState } from './ai-reviews.ts'
import { GRADE_ORDER } from './projects.ts'
import { sortStory, type StackOf } from './review-story.ts'

/**
 * The Review list as one list (_specs/067-review-list-one-list): every row says its own state, the rows are put in the
 * order the user picked, and the projects are quiet headings over their rows, a visual aid only. Pure, so it is tested
 * without a window.
 */

/** What a row says in the place where its grades go, when it has none: its state, in the same words on every row. */
export function stateWords(state: RowState): string {
  switch (state.kind) {
    case 'reviewing':
      return state.percent != null ? `Reviewing · ${state.percent}%` : 'Reviewing'
    case 'waits':
      return state.ahead != null ? `Waits its turn · ${state.ahead} ahead` : 'Waits its turn'
    case 'failed':
      return 'Review failed'
    case 'ready':
      return 'Not rated'
  }
}

/** The words of a state that is news: nothing for a review that is ready. */
export const stateNews = (state: RowState): string | null => (state.kind === 'ready' ? null : stateWords(state))

/** The short word of each of the five grades, as the Work list says them. */
export const GRADE_WORDS: Readonly<Record<NeedName, string>> = { coverage: 'Cover', proof: 'Proof', safety: 'Safe', visibility: 'Watch', rollback: 'Undo' }

const momentOf = (row: ReviewRow) => row.startedAt ?? row.at ?? (Date.parse(row.item.updatedAt) || 0)
const priorityPlace = (row: ReviewRow) => (row.priority ? GRADE_ORDER[row.priority] : GRADE_ORDER.P3 + 1)
const linesOf = (row: ReviewRow) => row.item.lines ?? Number.MAX_SAFE_INTEGER

const COMPARE: Record<Exclude<ReviewOrder, 'easiest'>, (a: ReviewRow, b: ReviewRow) => number> = {
  priority: (a, b) => priorityPlace(a) - priorityPlace(b) || momentOf(a) - momentOf(b),
  newest: (a, b) => momentOf(b) - momentOf(a),
  oldest: (a, b) => momentOf(a) - momentOf(b),
  smallest: (a, b) => linesOf(a) - linesOf(b),
}

/**
 * The rows in the order picked; ties keep the order they came in. `easiest` is the story's own order for what waits on
 * the user, with a merge that failed before it, so a yes that did not land is never out of sight, and the reviews that
 * stopped after it.
 */
export function orderRows(rows: readonly ReviewRow[], order: ReviewOrder, stackOf: StackOf = () => null): ReviewRow[] {
  if (order !== 'easiest') return rows.toSorted(COMPARE[order])
  const merge = rows.filter((row) => row.merge)
  const failed = rows.filter((row) => !row.merge && row.state.kind === 'failed')
  const queue = rows.filter((row) => !row.merge && row.state.kind !== 'failed')
  return [...merge, ...sortStory(queue, stackOf), ...failed]
}

/** Which rows there are, whatever their order and whatever they say: a row's place changes only when this does. */
export const setKeyOf = (rows: readonly ReviewRow[]): string =>
  rows
    .map((row) => row.item.id)
    .toSorted()
    .join('\n')

/** The rows laid out as `ids` say, newest facts and all. A row that left is gone, and one that came is last. */
export function placedRows(ids: readonly string[], rows: readonly ReviewRow[]): ReviewRow[] {
  const byId = new Map(rows.map((row) => [row.item.id, row]))
  return ids.flatMap((id) => byId.get(id) ?? [])
}

export interface ProjectRows {
  project: string
  rows: ReviewRow[]
}

/** The rows cut by project, the projects in the order of their first row, so the order picked still decides what is on top. */
export function projectsOf(rows: readonly ReviewRow[]): ProjectRows[] {
  const projects = new Map<string, ReviewRow[]>()
  for (const row of rows) {
    const own = projects.get(row.item.project)
    if (own) own.push(row)
    else projects.set(row.item.project, [row])
  }
  return [...projects].map(([project, own]) => ({ project, rows: own }))
}
