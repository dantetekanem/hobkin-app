/**
 * The code view's files (spec 071): the changed files of a review in the order its story tells them, and what each row
 * of the list says of its file, as pi-coder's `/diff` lists them beside the diff. Pure, so the order and the facts are
 * tested without a screen.
 */
import type { Note } from '#shared/review/notes.ts'
import type { FileStatus, ReviewFile, ReviewNode, StoryStep } from '#shared/review/types.ts'
import { fileSeen, listed, partsInFile } from '../state/look.ts'

/**
 * The files the code view lists, in the order the story tells them: the first step that shows a file puts it first, by
 * the parts its focus stands for (`expand`, as a card stands for its tests) and their lines in order. A part with no
 * lines that names its file, as a binary file's, counts too. Files no step shows follow, by path. A file in the review
 * only for unchanged code shown in it is not listed.
 */
export function storyOrder(
  files: readonly ReviewFile[],
  steps: readonly Pick<StoryStep, 'focus'>[],
  expand: (id: string) => readonly string[],
  partOf: (id: string) => ReviewNode | undefined,
): ReviewFile[] {
  const changed = files.filter(listed)
  const byId = new Map(changed.map((file) => [file.id, file]))
  const byPath = new Map(changed.map((file) => [file.path, file]))
  const filesOf = (node: ReviewNode) => {
    if (node.anchors.length === 0 && node.subtitle != null) return [byPath.get(node.subtitle)]
    return node.anchors.map((anchor) => byId.get(anchor.fileId))
  }

  const told = new Map<string, ReviewFile>()
  for (const step of steps) {
    for (const node of step.focus.flatMap(expand).map(partOf)) {
      if (!node) continue
      for (const file of filesOf(node)) {
        if (file && !told.has(file.id)) told.set(file.id, file)
      }
    }
  }

  const rest = changed.filter((file) => !told.has(file.id)).sort(byPathName)
  return [...told.values(), ...rest]
}

const byPathName = (a: ReviewFile, b: ReviewFile) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)

export type StatusLetter = 'A' | 'M' | 'D' | 'R'

/** An unchanged file is never listed; one would read as modified. */
const LETTER: Record<FileStatus, StatusLetter> = { added: 'A', modified: 'M', deleted: 'D', renamed: 'R', unchanged: 'M' }

/** What a row of the list says of its file. */
export interface FileRow {
  file: ReviewFile
  letter: StatusLetter
  additions: number
  deletions: number
  /** The notes it carries: those on its lines, and those about its parts. */
  comments: number
  questions: number
  /** A part of it needs the reviewer: the host ranks it so, or the change review rates it high. */
  needsYou: boolean
  /** Every changed part of it is seen (`fileSeen`). */
  seen: boolean
}

/** The rows of the list, one for each file, in the order given. */
export function fileRows(
  files: readonly ReviewFile[],
  { nodes, notes, seen }: { nodes: readonly ReviewNode[]; notes: readonly Note[]; seen: ReadonlySet<string> },
): FileRow[] {
  return files.map((file) => {
    const parts = partsInFile(nodes, file)
    const ids = new Set(parts.map((node) => node.id))
    const carried = notes.filter(({ target }) => {
      if (target.kind === 'lines') return target.fileId === file.id
      return target.kind === 'node' && ids.has(target.node)
    })
    return {
      file,
      letter: LETTER[file.status],
      additions: file.additions,
      deletions: file.deletions,
      comments: carried.filter((note) => note.intent === 'comment').length,
      questions: carried.filter((note) => note.intent === 'question').length,
      needsYou: parts.some((node) => node.attention?.tier === 'needs-you' || node.level === 'high'),
      seen: fileSeen(nodes, file, seen),
    }
  })
}

/** The list's top line: how many files and lines changed. */
export function totalsOf(rows: readonly Pick<FileRow, 'additions' | 'deletions'>[]): { files: number; additions: number; deletions: number } {
  return {
    files: rows.length,
    additions: rows.reduce((sum, row) => sum + row.additions, 0),
    deletions: rows.reduce((sum, row) => sum + row.deletions, 0),
  }
}

/** A name too long for its room keeps both its ends, so `review-look.test.ts` and `review-look.ts` stay apart. */
function shortenMiddle(text: string, width: number): string {
  if (text.length <= width) return text
  if (width <= 1) return '…'
  const tail = text.slice(text.length - Math.floor((width - 1) / 2))
  return `${text.slice(0, width - 1 - tail.length)}…${tail}`
}

/**
 * A path in `width` characters, shortened from the left: as many of its last folders as fit after `…/`, else the file's
 * name alone, shortened in its middle when even that is too long (pi-coder's `shortenNavigatorPath`).
 */
export function shortenPath(path: string, width: number): string {
  const room = Math.max(1, width)
  if (path.length <= room) return path
  const parts = path.split('/').filter(Boolean)
  const name = parts.at(-1) ?? path
  if (parts.length <= 1) return shortenMiddle(name, room)
  let kept = name
  for (let index = parts.length - 2; index >= 0; index -= 1) {
    const longer = `${parts[index]}/${kept}`
    if (`…/${longer}`.length > room) break
    kept = longer
  }
  const shortened = `…/${kept}`
  return shortened.length <= room ? shortened : shortenMiddle(name, room)
}
