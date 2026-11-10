import { diffArrays } from 'diff'
import type { AnchorSide } from './types.ts'

export type RowKind = 'equal' | 'insert' | 'delete' | 'replace'

/** One row of a file's diff. A `replace` row pairs a removed line with the line that took its place. */
export interface AlignedRow {
  kind: RowKind
  oldLine?: number
  newLine?: number
  oldText: string
  newText: string
}

/** A run of changed lines on one side of a file. Lines are 1-based and inclusive. */
export interface ChangeRange {
  fileId: string
  side: AnchorSide
  startLine: number
  endLine: number
}

/**
 * Lines with their separators kept, so a change to a line ending or to the final newline is a change,
 * as git shows it. The row text drops the separator.
 */
function terminatedLines(text: string): string[] {
  return text.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g) ?? []
}

const bare = (line: string) => line.replace(/(?:\r\n|\r|\n)$/, '')

/**
 * Both sides of a file, line by line. Within a group of changes the removed and added lines pair up
 * in order, as in pi-coder's `buildStructuredDiff`; what is left over is a plain delete or insert.
 */
export function alignRows(base: string, head: string): AlignedRow[] {
  const rows: AlignedRow[] = []
  let oldLine = 1
  let newLine = 1
  let removed: string[] = []
  let added: string[] = []

  const flush = () => {
    const count = Math.max(removed.length, added.length)
    for (let index = 0; index < count; index += 1) {
      const oldText = removed[index]
      const newText = added[index]
      if (oldText != null && newText != null) rows.push({ kind: 'replace', oldLine: oldLine++, newLine: newLine++, oldText: bare(oldText), newText: bare(newText) })
      else if (oldText != null) rows.push({ kind: 'delete', oldLine: oldLine++, oldText: bare(oldText), newText: '' })
      else rows.push({ kind: 'insert', newLine: newLine++, oldText: '', newText: bare(newText!) })
    }
    removed = []
    added = []
  }

  for (const change of diffArrays(terminatedLines(base), terminatedLines(head))) {
    if (change.removed) removed.push(...change.value)
    else if (change.added) added.push(...change.value)
    else {
      flush()
      for (const line of change.value) {
        const text = bare(line)
        rows.push({ kind: 'equal', oldLine: oldLine++, newLine: newLine++, oldText: text, newText: text })
      }
    }
  }
  flush()
  return rows
}

export function countChanges(rows: readonly AlignedRow[]): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const row of rows) {
    if (row.kind === 'insert' || row.kind === 'replace') additions += 1
    if (row.kind === 'delete' || row.kind === 'replace') deletions += 1
  }
  return { additions, deletions }
}

/** The changed lines of each side, in file order, with lines that touch merged into one range. */
export function changedRanges(fileId: string, rows: readonly AlignedRow[]): ChangeRange[] {
  const ranges: ChangeRange[] = []
  const last: Partial<Record<AnchorSide, ChangeRange>> = {}
  const add = (side: AnchorSide, line: number) => {
    const previous = last[side]
    if (previous && previous.endLine + 1 === line) {
      previous.endLine = line
      return
    }
    const range = { fileId, side, startLine: line, endLine: line }
    last[side] = range
    ranges.push(range)
  }
  for (const row of rows) {
    if ((row.kind === 'delete' || row.kind === 'replace') && row.oldLine != null) add('deleted', row.oldLine)
    if ((row.kind === 'insert' || row.kind === 'replace') && row.newLine != null) add('added', row.newLine)
  }
  return ranges
}
