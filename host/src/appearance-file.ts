import { constants, closeSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { decodeAppearanceStyle, encodeAppearanceStyle } from './appearance-style.ts'

/** Twelve kept themes with long names and the user's words fit with room to spare. */
const THEMES_MAX_BYTES = 32768

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}
function argumentsFor(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) {
    throw new Error('Only the fixed custom style content is accepted; no paths or extra arguments.')
  }
  return value as Record<string, unknown>
}

/** Fixed-file capability only; it does not restrict a caller's other tools. Root is already admitted by the host. */
export class AppearanceFile {
  private readonly directory: string
  private readonly path: string
  private readonly resolvedRoot: string
  constructor(resolvedRoot: string) {
    this.resolvedRoot = resolvedRoot
    if (!isAbsolute(resolvedRoot)) throw new Error('An admitted absolute data root is required.')
    this.directory = join(resolvedRoot, 'client')
    this.path = join(this.directory, 'custom.css')
  }

  private checkDirectory(create = false): boolean {
    if (!lstatSync(this.resolvedRoot).isDirectory()) throw new Error('Data root must be a regular directory.')
    try {
      if (!lstatSync(this.directory).isDirectory()) throw new Error('Client path must be a regular directory.')
    } catch (error) {
      if (!missing(error)) throw error
      if (!create) return false
      mkdirSync(this.directory, { mode: 0o700 })
    }
    return true
  }

  read(args: unknown): string | null {
    argumentsFor(args, [])
    const content = this.readArtifact(this.path, 4096)
    return content === null ? null : encodeAppearanceStyle(decodeAppearanceStyle(content))
  }

  readPhoto(): 'milky-way' | null {
    const content = this.readArtifact(join(this.directory, 'custom-photo'), 64)
    if (content === null || content === 'none\n') return null
    if (content !== 'milky-way\n') throw new Error('Unknown bundled photo selection.')
    return 'milky-way'
  }

  replacePhoto(id: 'milky-way' | null): void {
    if (id !== null && id !== 'milky-way') throw new Error('Only the bundled Milky Way photo or null is accepted.')
    this.replaceArtifact(join(this.directory, 'custom-photo'), `${id ?? 'none'}\n`)
  }

  /** The kept custom themes (`theme-history.ts`) as their file holds them, or null before there are any. */
  readThemes(): string | null {
    return this.readArtifact(join(this.directory, 'themes.json'), THEMES_MAX_BYTES)
  }

  replaceThemes(content: string): void {
    if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > THEMES_MAX_BYTES) {
      throw new Error(`The kept themes must be text of at most ${THEMES_MAX_BYTES} bytes.`)
    }
    this.replaceArtifact(join(this.directory, 'themes.json'), content)
  }

  private readArtifact(path: string, maxBytes: number): string | null {
    if (!this.checkDirectory()) return null
    let fd: number
    try {
      if (!lstatSync(path).isFile()) throw new Error('Theme artifact must be a regular file.')
      fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    } catch (error) {
      if (missing(error)) return null
      throw error
    }
    try {
      const stat = fstatSync(fd)
      if (!stat.isFile() || stat.size > maxBytes || stat.uid !== process.getuid?.()) {
        throw new Error(`Theme artifact must be an owned regular file of at most ${maxBytes} bytes.`)
      }
      const bytes = Buffer.alloc(maxBytes + 1)
      let size = 0
      while (size < bytes.length) {
        const count = readSync(fd, bytes, size, bytes.length - size, null)
        if (!count) break
        size += count
      }
      if (size > maxBytes) throw new Error(`Theme artifact exceeds ${maxBytes} bytes.`)
      return bytes.subarray(0, size).toString('utf8')
    } finally { closeSync(fd) }
  }

  /** Removes the saved custom style, so a restart does not bring it back. Nothing to do when there is none. */
  remove(): void {
    if (!this.checkDirectory()) return
    try { unlinkSync(this.path) }
    catch (error) { if (!missing(error)) throw error }
  }

  replace(args: unknown): string {
    const { content } = argumentsFor(args, ['content'])
    const canonical = encodeAppearanceStyle(decodeAppearanceStyle(content))
    this.replaceArtifact(this.path, canonical)
    return canonical
  }

  private replaceArtifact(path: string, content: string): void {
    this.checkDirectory(true)
    try {
      const stat = lstatSync(path)
      if (!stat.isFile() || stat.uid !== process.getuid?.()) throw new Error('Theme artifact must be an owned regular file.')
    } catch (error) { if (!missing(error)) throw error }
    const temporary = join(this.directory, `.custom-${randomUUID()}.tmp`)
    const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    try {
      writeFileSync(fd, content, 'utf8')
      fsyncSync(fd)
      closeSync(fd)
    } catch (error) {
      try { closeSync(fd) } catch { /* Already closed. */ }
      unlinkSync(temporary)
      throw error
    }
    try { renameSync(temporary, path) }
    catch (error) { unlinkSync(temporary); throw error }
  }
}
