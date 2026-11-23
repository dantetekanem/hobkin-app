import { diffOf, startView, unifiedRows, type Diff, type DiffItem, type FileSides } from '@/features/review/code/diff-rows.ts'
import type { Change } from './steps.ts'

/** One place a file changed, as the review draws it. */
export interface Part {
  key: string
  file: FileSides
  /** Its diff, worked out once for the counts and the rows. */
  diff: Diff
  /** The rows its diff starts with (lines and the gaps between them), and how many of them are lines. */
  rows: number
  lines: number
  additions: number
  deletions: number
  /** False for an edit: its place in the file is not known, so it gets no line numbers. */
  numbered: boolean
}

const startRows = new WeakMap<Diff, DiffItem[]>()

/** The rows a diff starts with, before any "Show more": worked out once for each diff, for its counts and to draw it. */
export function startRowsOf(diff: Diff): DiffItem[] {
  let rows = startRows.get(diff)
  if (!rows) startRows.set(diff, (rows = unifiedRows(diff, startView(diff))))
  return rows
}

/**
 * Each place a change holds, with its diff. A part of `kept`, the ones drawn before, with the same sides is kept as it
 * was: a new edit diffs only the place it added or changed, and a call finishing or the run ending diffs nothing.
 */
export function partsOf(change: Change, kept: readonly Part[] = []): Part[] {
  const part = (key: string, base: string | null, head: string, numbered: boolean): Part => {
    const known = kept.find(({ file }) => file.path === change.path && file.base === base && file.head === head)
    if (known) return known.key === key ? known : { ...known, key }
    const diff = diffOf(base, head)
    const rows = startRowsOf(diff)
    return { key, file: { path: change.path, base, head, binary: false }, diff, rows: rows.length, lines: rows.filter((row) => row.type === 'line').length, additions: diff.additions, deletions: diff.deletions, numbered }
  }
  if (change.whole !== null) return [part('whole', null, change.whole, true)]
  return change.hunks.filter((hunk) => hunk.oldText !== hunk.newText).map((hunk, index) => part(`hunk${index}`, hunk.oldText, hunk.newText, false))
}
