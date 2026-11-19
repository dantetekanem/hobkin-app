import { createHash, randomUUID } from 'node:crypto'
import { closeSync, constants, fchmodSync, fstatSync, fsyncSync, linkSync, openSync, readFileSync, readSync, renameSync, unlinkSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DIRECTIONS_MAX_BYTES, DIRECTIONS_MISSING, type DirectionsFile, type DirectionsSaved } from '#shared/protocol/directions.ts'
import { Unavailable, type HostHandlers } from './commands.ts'

/**
 * hobkin's directions, `AGENTS.md` in its home, read and saved from Settings. hobkin reads the file whole on every
 * message, routine and run (`readDirections` in its `src/cli/directions.mjs`): only a regular file, at most 64 KB, never
 * cut short. hobkin's own agents may write it while the editor is open, so a save carries the version it read and is
 * refused when the file moved on since.
 */

const DEFAULT_DIRECTIONS = fileURLToPath(import.meta.resolve('hobkin/src/prompts/agents-default.md'))
const bytes = (count: number) => count.toLocaleString('en-US')
const notRegular = () => new Unavailable("AGENTS.md in hobkin's home is not a regular file (a link, a folder or a device), so hobkin does not read it and it cannot be edited here.")
class TooLarge extends Unavailable {}
const tooLarge = (size: number) => new TooLarge(`AGENTS.md is ${bytes(size)} bytes, over the ${bytes(DIRECTIONS_MAX_BYTES)} hobkin reads, so hobkin refuses it whole. Shorten it in another editor.`)

const versionOf = (content: Buffer | string) => createHash('sha256').update(content).digest('hex')
const directionsPath = (root: string) => join(root, 'AGENTS.md')

/** The file as it is, or null when there is none. Opened without following a link, and checked again once open. */
function current(path: string): { content: Buffer; mode: number } | null {
  let fd: number
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return null
    if (code === 'ELOOP') throw notRegular()
    throw error
  }
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile()) throw notRegular()
    if (stat.size > DIRECTIONS_MAX_BYTES) throw tooLarge(stat.size)
    // One byte past the cap settles that a file growing as it is read is too large as well.
    const content = Buffer.alloc(DIRECTIONS_MAX_BYTES + 1)
    let size = 0
    while (size < content.length) {
      const count = readSync(fd, content, size, content.length - size, null)
      if (!count) break
      size += count
    }
    if (size > DIRECTIONS_MAX_BYTES) throw tooLarge(size)
    return { content: content.subarray(0, size), mode: stat.mode & 0o777 }
  } finally {
    closeSync(fd)
  }
}

export function readDirections(root: string): DirectionsFile {
  const path = directionsPath(root)
  const file = current(path)
  if (!file) return { path, text: readFileSync(DEFAULT_DIRECTIONS, 'utf8'), version: DIRECTIONS_MISSING, exists: false }
  return { path, text: file.content.toString('utf8'), version: versionOf(file.content), exists: true }
}

/** The version the file has now, and its mode, for a save to compare with and keep. */
function now(path: string): { version: string; mode: number } {
  try {
    const file = current(path)
    return file ? { version: versionOf(file.content), mode: file.mode } : { version: DIRECTIONS_MISSING, mode: 0o600 }
  } catch (error) {
    // Grown past the cap since it was read: no version the editor holds matches it, so the save is refused as a change.
    if (error instanceof TooLarge) return { version: 'too-large', mode: 0o600 }
    throw error
  }
}

/**
 * Writes a whole new file beside the old one and renames it over, so a reader sees one or the other, never half.
 * A file that was missing is linked into place instead, which fails when one appeared meanwhile.
 */
export function saveDirections(root: string, { text, version }: { text: string; version: string }): DirectionsSaved {
  const content = Buffer.from(text, 'utf8')
  if (content.length > DIRECTIONS_MAX_BYTES) {
    throw new Unavailable(`The directions are ${bytes(content.length)} bytes, over the ${bytes(DIRECTIONS_MAX_BYTES)} hobkin reads. Nothing was saved.`)
  }
  const path = directionsPath(root)
  const changed = { saved: false, message: 'AGENTS.md changed since the editor opened it, perhaps by one of hobkin\'s agents. Nothing was saved: reload to see the new copy.' } as const
  const found = now(path)
  if (found.version !== version) return changed

  const temporary = join(root, `.AGENTS.md-${randomUUID()}.tmp`)
  const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
  try {
    // Set after the open, so the user's umask does not change the mode the file had.
    fchmodSync(fd, found.mode)
    for (let written = 0; written < content.length; ) written += writeSync(fd, content, written)
    fsyncSync(fd)
  } catch (error) {
    closeSync(fd)
    unlinkSync(temporary)
    throw error
  }
  closeSync(fd)
  try {
    if (version === DIRECTIONS_MISSING) {
      try {
        linkSync(temporary, path)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') return changed
        throw error
      }
    } else {
      renameSync(temporary, path)
    }
  } finally {
    try {
      unlinkSync(temporary)
    } catch {
      // Renamed into place.
    }
  }
  return { saved: true, file: { path, text: content.toString('utf8'), version: versionOf(content), exists: true } }
}

export function directionsHandlers({ root }: { root: () => string }): HostHandlers {
  return {
    'directions.read': () => readDirections(root()),
    'directions.save': (args) => saveDirections(root(), args),
  }
}
