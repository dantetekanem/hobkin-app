import { alignRows, changedRanges, countChanges, type ChangeRange } from './diff.ts'
import { fileRole } from './paths.ts'
import { sha256 } from './sha256.ts'
import { SIZE_LIMIT, type FileStatus } from './types.ts'

export interface ChangedPath {
  /** Path at head, or at base for a deleted file. */
  path: string
  /** Path at base, when the file was renamed. */
  oldPath?: string
  status: Exclude<FileStatus, 'unchanged'>
  /**
   * The lines it changes, when the source counted them already and reading the file would cost too much, such as a
   * pull request's files past the size limits. Such a file is summarized and never read.
   */
  counted?: { additions: number; deletions: number }
}

export type FileRead = { kind: 'text'; text: string } | { kind: 'binary' } | { kind: 'missing' }

/** How the capture reads a repository. The host reads git; tests and sample data read memory. */
export interface ChangeReader {
  /** The paths that differ between two commits, with renames found. */
  changed(base: string, head: string): Promise<ChangedPath[]>
  /** One file at one commit. */
  read(commit: string, path: string): Promise<FileRead>
}

export interface CapturedFile {
  /** The path, which is unique within a capture. Anchors refer to a file by this id. */
  id: string
  path: string
  oldPath?: string
  status: Exclude<FileStatus, 'unchanged'>
  binary: boolean
  /** The file at base. Null when it does not exist there, or is binary. */
  base: string | null
  /** The file at head. Null when it does not exist there, or is binary. */
  head: string | null
  additions: number
  deletions: number
  /** Over the size limits: this file becomes one `file` node without units. */
  summarized: boolean
  /** Never read: the source counted its lines, and it is summarized. */
  skipped?: boolean
}

/** Pass 1 of preparing a review: the exact bytes of a change, read once, before anything interprets them. */
export interface Capture {
  base: string
  head: string
  /** SHA-256 over both sides of every changed file. Any byte that differs gives another fingerprint. */
  fingerprint: string
  /** Every changed file, sorted by path. */
  files: CapturedFile[]
  additions: number
  deletions: number
  /** Every changed line of every text file, as ranges per side. */
  changes: ChangeRange[]
}

export interface SizeLimit {
  files: number
  changedLines: number
}

const byPath = (a: { path: string }, b: { path: string }) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)

/**
 * Reads both sides of every changed file between `base` and `head`.
 *
 * Detail is kept for the first files within the limits, code and tests before prose and data,
 * so a large lockfile cannot use up the room the code needs. The rest are marked `summarized`.
 */
export async function captureChange(reader: ChangeReader, base: string, head: string, limit: SizeLimit = SIZE_LIMIT): Promise<Capture> {
  const paths = [...(await reader.changed(base, head))].sort(byPath)
  const changes: ChangeRange[] = []

  const files = await Promise.all(
    paths.map(async ({ path, oldPath, status, counted }): Promise<CapturedFile> => {
      if (counted) return { id: path, path, ...(oldPath ? { oldPath } : {}), status, binary: false, base: null, head: null, ...counted, summarized: true, skipped: true }
      const [before, after] = await Promise.all([
        status === 'added' ? missing : reader.read(base, oldPath ?? path),
        status === 'deleted' ? missing : reader.read(head, path),
      ])
      const binary = before.kind === 'binary' || after.kind === 'binary'
      return {
        id: path,
        path,
        ...(oldPath ? { oldPath } : {}),
        status,
        binary,
        base: !binary && before.kind === 'text' ? before.text : null,
        head: !binary && after.kind === 'text' ? after.text : null,
        additions: 0,
        deletions: 0,
        summarized: false,
      }
    }),
  )

  for (const file of files) {
    if (file.binary || file.skipped) continue
    const rows = alignRows(file.base ?? '', file.head ?? '')
    Object.assign(file, countChanges(rows))
    changes.push(...changedRanges(file.id, rows))
  }

  let kept = 0
  let changedLines = 0
  for (const file of [...files].sort((a, b) => detailRank(a.path) - detailRank(b.path) || byPath(a, b))) {
    if (file.skipped) continue
    const size = file.additions + file.deletions
    if (kept < limit.files && changedLines + size <= limit.changedLines) {
      kept += 1
      changedLines += size
    } else file.summarized = true
  }

  return {
    base,
    head,
    fingerprint: fingerprint(files),
    files,
    additions: files.reduce((total, file) => total + file.additions, 0),
    deletions: files.reduce((total, file) => total + file.deletions, 0),
    changes,
  }
}

const missing: Promise<FileRead> = Promise.resolve({ kind: 'missing' })

/** Code and tests keep their detail first. Prose, data and everything else come after. */
function detailRank(path: string): number {
  return fileRole(path) === 'file' ? 1 : 0
}

function fingerprint(files: readonly CapturedFile[]): string {
  return sha256(JSON.stringify(files.map((file) => [file.id, file.oldPath ?? null, file.status, file.binary, file.base, file.head])))
}

/** The text of one side of a captured file. Empty when the file does not exist on that side. */
export function sideText(file: Pick<CapturedFile, 'base' | 'head'>, side: 'added' | 'deleted'): string {
  return (side === 'added' ? file.head : file.base) ?? ''
}
