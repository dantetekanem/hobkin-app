import { constants, closeSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { decodeAppearanceStyle, encodeAppearanceStyle } from './appearance-style.ts'

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
    if (!this.checkDirectory()) return null
    let fd: number
    try {
      if (!lstatSync(this.path).isFile()) throw new Error('Custom style must be a regular file.')
      fd = openSync(this.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    } catch (error) {
      if (missing(error)) return null
      throw error
    }
    try {
      const stat = fstatSync(fd)
      if (!stat.isFile() || stat.size > 4096) throw new Error('Custom style must be a regular file of at most 4096 bytes.')
      const bytes = Buffer.alloc(4097)
      let size = 0
      while (size < bytes.length) {
        const count = readSync(fd, bytes, size, bytes.length - size, null)
        if (!count) break
        size += count
      }
      if (size > 4096) throw new Error('Custom style exceeds 4096 bytes.')
      return encodeAppearanceStyle(decodeAppearanceStyle(bytes.subarray(0, size).toString('utf8')))
    } finally { closeSync(fd) }
  }

  replace(args: unknown): string {
    const { content } = argumentsFor(args, ['content'])
    const canonical = encodeAppearanceStyle(decodeAppearanceStyle(content))
    this.checkDirectory(true)
    try {
      if (!lstatSync(this.path).isFile()) throw new Error('Custom style must be a regular file.')
    } catch (error) { if (!missing(error)) throw error }
    const temporary = join(this.directory, `.custom-${randomUUID()}.tmp`)
    const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    try {
      writeFileSync(fd, canonical, 'utf8')
      fsyncSync(fd)
      closeSync(fd)
    } catch (error) {
      try { closeSync(fd) } catch { /* Already closed. */ }
      unlinkSync(temporary)
      throw error
    }
    try { renameSync(temporary, this.path) }
    catch (error) { unlinkSync(temporary); throw error }
    return canonical
  }
}
