import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import type { SavedJobSession } from '#shared/commands/registry.ts'
import { Unavailable } from './commands.ts'

export interface JobSessionSeat {
  data: () => string
  snapshot: () => { reports?: unknown; completedJobReports?: unknown }
  state: () => Promise<{ runs: Record<string, { kind?: string; harness?: string; harnessId?: string; legacy?: boolean; result?: { sessionId?: string | null } }> }>
}
const UUID = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const sameFile = (a: { dev: number; ino: number }, b: { dev: number; ino: number }) => a.dev === b.dev && a.ino === b.ino

/** Resolves only native background jobs through trusted report/run metadata, never through a supplied path. */
export async function readJobSession(seat: JobSessionSeat, report: string, bytes = 2 * 1024 * 1024): Promise<SavedJobSession> {
  const snapshot = seat.snapshot()
  const mapped = Object.entries(object(snapshot.completedJobReports) ?? {}).filter(([, row]) => object(row)?.id === report).map(([id]) => id)
  if (mapped.length > 1) throw new Unavailable('That report has ambiguous run ownership.')
  const listed = Array.isArray(snapshot.reports) && snapshot.reports.some(row => object(row)?.id === report)
  if (!mapped.length && !listed) throw new Unavailable('That report is not in hobkin’s list.')
  const id = mapped[0] ?? report
  const state = await seat.state()
  const run = Object.hasOwn(state.runs, id) ? state.runs[id] : undefined
  if (run?.kind !== 'background' || run.harness !== 'pi' || run.legacy || !UUID.test(run.harnessId ?? '')) {
    throw new Unavailable('This report has no supported native Pi job session.')
  }
  // Every supported producer stores jobs/<harnessId>.jsonl. Imported sessions use another boundary and are refused.
  let text: string
  try {
    const root = await realpath(seat.data())
    const folder = join(root, 'jobs')
    const parent = await lstat(folder)
    if (!parent.isDirectory() || await realpath(folder) !== folder) throw Error('Unsafe jobs folder')
    const file = join(folder, `${run.harnessId}.jsonl`)
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.nlink !== 1 || !sameFile(stat, await lstat(file)) || !sameFile(parent, await lstat(folder)) || await realpath(folder) !== folder) throw Error('Unsafe job file')
      if (stat.size > bytes) throw new Unavailable(`The saved run exceeds the ${bytes.toLocaleString('en-US')}-byte read limit; no partial branch was opened.`)
      const buffer = Buffer.alloc(bytes + 1)
      let length = 0
      while (length < buffer.length) {
        const read = await handle.read(buffer, length, buffer.length - length, length)
        if (!read.bytesRead) break
        length += read.bytesRead
      }
      if (length > bytes) throw new Unavailable(`The saved run exceeds the ${bytes.toLocaleString('en-US')}-byte read limit; no partial branch was opened.`)
      if (!sameFile(parent, await lstat(folder)) || await realpath(folder) !== folder) throw Error('Jobs folder changed')
      text = buffer.subarray(0, length).toString('utf8')
    } finally { await handle.close() }
  } catch (error) {
    if (error instanceof Unavailable) throw error
    throw new Unavailable('The saved job session is missing or unavailable: only a regular file in its own jobs folder can be read.')
  }
  const rows = new Map<string, Record<string, unknown>>()
  let header = false, skipped = 0, last: string | null = null
  const lines = text.split('\n')
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue
    let row: Record<string, unknown> | null
    try { row = object(JSON.parse(line)) } catch {
      if (header && index === lines.length - 1 && !text.endsWith('\n')) { skipped++; break }
      throw new Unavailable('The saved job session contains a malformed record.')
    }
    if (!header) {
      if (row?.type !== 'session' || (row.version !== 2 && row.version !== 3) || typeof row.id !== 'string') throw new Unavailable('Unsupported Pi job session format.')
      if (run.result?.sessionId && row.id !== run.result.sessionId) throw new Unavailable('The saved Pi session identity does not match this run.')
      header = true
    } else {
      if (!row || typeof row.id !== 'string' || rows.has(row.id) || (row.parentId !== null && typeof row.parentId !== 'string')) throw new Unavailable('The saved job session has an invalid branch.')
      rows.set(row.id, row); last = row.id
    }
  }
  if (!header) throw new Unavailable('Unsupported Pi job session format.')
  const entries: Record<string, unknown>[] = []
  const visited = new Set<string>()
  // Read history, not reconstructed model context: compaction/context edits never erase stored messages here.
  while (last !== null) {
    const row = rows.get(last)
    if (!row || visited.has(last)) throw new Unavailable('The saved job session has an incomplete or cyclic branch.')
    visited.add(last); entries.push(row); last = row.parentId as string | null
  }
  return { report, run: id, entries: entries.reverse(), cut: false, skipped, limit: bytes }
}
