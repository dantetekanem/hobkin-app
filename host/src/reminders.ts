import { randomUUID } from 'node:crypto'
import { constants, closeSync, fstatSync, fsyncSync, lstatSync, openSync, readSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { decodeOccurrences, type ReminderState } from '#shared/protocol/reminders.ts'
import { Unavailable, type HostHandlers } from './commands.ts'

const MAX_BYTES = 64 * 1024
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'

/** The host admits the root; neither the window nor report text supplies a filename. No creation command is exposed. */
function metadataPath(home: string): string | null {
  if (!isAbsolute(home) || !lstatSync(home).isDirectory()) throw Error('An admitted data directory is required.')
  const directory = join(home, 'client')
  try {
    const stat = lstatSync(directory)
    if (!stat.isDirectory() || stat.uid !== process.getuid?.()) throw Error('Reminder directory must be owned and not a symlink.')
  } catch (error) {
    if (missing(error)) return null
    throw error
  }
  return join(directory, 'reminder-occurrences.json')
}

/** Reads only the explicit occurrence metadata, independently of report retention/read/delivery state. */
export function reminderState(home: string): ReminderState {
  const path = metadataPath(home)
  if (!path) return { home, entries: [] }
  let fd: number
  try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK) }
  catch (error) {
    if (missing(error)) return { home, entries: [] }
    throw error
  }
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || stat.size > MAX_BYTES) throw Error('Reminder metadata must be a bounded, owned regular file.')
    const bytes = Buffer.alloc(MAX_BYTES + 1)
    let size = 0
    while (size < bytes.length) {
      const count = readSync(fd, bytes, size, bytes.length - size, null)
      if (!count) break
      size += count
    }
    if (size > MAX_BYTES) throw Error('Reminder metadata is too large.')
    return { home, entries: decodeOccurrences(JSON.parse(bytes.subarray(0, size).toString('utf8'))) }
  } finally { closeSync(fd) }
}

/** The first explicit terminal choice wins. No TTL, read receipt or archival can reopen it. */
function resolveReminder(home: string, id: string, status: 'done' | 'dismissed'): void {
  const state = reminderState(home)
  const entry = state.entries.find(row => row.id === id)
  if (!entry) throw new Unavailable('That reminder is not in this home.')
  if (entry.status !== 'pending-confirmation') return
  entry.status = status
  entry.resolvedAt = new Date().toISOString()
  const content = `${JSON.stringify({ version: 1, entries: state.entries }, null, 2)}\n`
  if (Buffer.byteLength(content) > MAX_BYTES) throw Error('Reminder metadata is too large.')
  const path = metadataPath(home)
  if (!path) throw new Unavailable('The reminder directory is gone.')
  const temporary = join(home, 'client', `.reminder-${randomUUID()}.tmp`)
  const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
  try {
    writeFileSync(fd, content, 'utf8')
    fsyncSync(fd)
  } catch (error) {
    unlinkSync(temporary)
    throw error
  } finally { closeSync(fd) }
  try { renameSync(temporary, path) }
  catch (error) { unlinkSync(temporary); throw error }
}

export function reminderHandlers({ root, changed }: { root: () => string; changed: () => void }): HostHandlers {
  return {
    'reminder.resolve': ({ home, id, status }) => {
      if (home !== root()) throw new Unavailable('The reminder belongs to a different home.')
      resolveReminder(home, id, status)
      changed()
      return { ok: true }
    },
  }
}
