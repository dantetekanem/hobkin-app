import { alignRows, countChanges } from '#shared/review/diff.ts'
import { diffOf, startView, unifiedRows, type Diff, type DiffItem, type FileSides } from '@/features/review/code/diff-rows.ts'
import type { Change } from './steps.ts'

/** One place a file changed: its two sides, and how many lines it added and removed, as the change's row says them. */
export interface Place {
  key: string
  file: FileSides
  /** False for an edit: its place in the file is not known, so it gets no line numbers. */
  numbered: boolean
  additions: number
  deletions: number
}

/** A place of an open change, as the review draws it. */
export interface Part extends Place {
  /** Its diff, worked out once, when the change is first open. */
  diff: Diff
  /** The rows its diff starts with (lines and the gaps between them), and how many of them are lines. */
  rows: number
  lines: number
}

/** A file's lines as the review's diff counts them: each ended line, and a last one with no end. */
const lineCount = (text: string) => (text.match(/\r\n|\r|\n/g)?.length ?? 0) + (/[^\r\n]$/.test(text) ? 1 : 0)

const sameSides = (file: FileSides, path: string, base: string | null, head: string | null) => file.path === path && file.base === base && file.head === head

/**
 * Each place a change holds, with how many lines it added and removed, read without its diff: a write's additions are
 * its lines, and an edit's are counted from its two sides' lines lined up, as the diff would. A place of `kept`, the
 * ones read before, with the same sides is kept as it was, so a new edit counts only the place it added or changed, and
 * a call finishing or the run ending counts nothing.
 */
export function placesOf(change: Change, kept: readonly Place[] = []): Place[] {
  const place = (key: string, base: string | null, head: string, numbered: boolean): Place => {
    const known = kept.find(({ file }) => sameSides(file, change.path, base, head))
    if (known) return known.key === key ? known : { ...known, key }
    const counts = base === null ? { additions: lineCount(head), deletions: 0 } : countChanges(alignRows(base, head))
    return { key, file: { path: change.path, base, head, binary: false }, numbered, ...counts }
  }
  if (change.whole !== null) return [place('whole', null, change.whole, true)]
  return change.hunks.filter((hunk) => hunk.oldText !== hunk.newText).map((hunk, index) => place(`hunk${index}`, hunk.oldText, hunk.newText, false))
}

/**
 * The places of an open change, each with its diff. A part of `kept`, the ones drawn before, for the same sides is kept
 * as it was, so a new edit diffs only the place it added or changed, and a call finishing or the run ending diffs nothing.
 */
export function diffsOf(places: readonly Place[], kept: readonly Part[] = []): Part[] {
  return places.map((place) => {
    const known = kept.find(({ file }) => sameSides(file, place.file.path, place.file.base, place.file.head))
    if (known) return known.key === place.key ? known : { ...known, key: place.key }
    const diff = diffOf(place.file.base, place.file.head)
    const rows = startRowsOf(diff)
    return { ...place, diff, rows: rows.length, lines: rows.filter((row) => row.type === 'line').length }
  })
}

const startRows = new WeakMap<Diff, DiffItem[]>()

/** The rows a diff starts with, before any "Show more": worked out once for each diff, for its counts and to draw it. */
export function startRowsOf(diff: Diff): DiffItem[] {
  let rows = startRows.get(diff)
  if (!rows) startRows.set(diff, (rows = unifiedRows(diff, startView(diff))))
  return rows
}
