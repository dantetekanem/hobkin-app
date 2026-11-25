import { constants } from 'node:fs'
import { type FileHandle, open, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, extname, isAbsolute, join } from 'node:path'
import type { FileContent, ImageType } from '#shared/protocol/files.ts'
import { Unavailable } from './commands.ts'
import { imageTypeOf } from './image-type.ts'

/**
 * Reading a file the user clicked, for the viewer (_specs/027-links-and-files). A small text file or an image, and
 * only a regular file: a folder, a device, a pipe or a link to one is refused. A symlink is followed and the answer
 * names the file it led to.
 */

/** The most a text file may weigh to be shown. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024

/**
 * The most an image may weigh to be drawn. A full-screen screenshot of a 5K or 6K Retina display is a 5 to 15 MB PNG
 * and fits; the answer then stays under 27 MB of base64 on the window's local socket, which it crosses at once.
 */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024

/** How far into a file a zero byte settles that it is not text, and how much of it tells an image. */
const SNIFF_BYTES = 8000

const MARKDOWN = new Set(['.md', '.markdown', '.mdx'])

/** Programs and bundles: opening one in its default app would run it, so they never open from a link. */
const PROGRAMS = new Set(['.app', '.command', '.tool', '.terminal', '.workflow', '.action', '.scpt', '.scptd', '.pkg', '.mpkg', '.dmg', '.jar', '.webloc', '.url', '.inetloc', '.fileloc', '.shortcut', '.service', '.prefpane', '.saver', '.kext', '.sh', '.bash', '.zsh', '.csh', '.pl', '.py', '.rb'])

export interface FileOptions {
  /** What `~/` stands for. */
  home?: string
  maxBytes?: number
  maxImageBytes?: number
}

/** `~/x` as a path under the home. Only a full path or `~/` is taken. */
function expand(path: string, home: string): string {
  if (path.startsWith('~/')) return join(home, path.slice(2))
  if (isAbsolute(path)) return path
  throw new Unavailable('Only a full path or one that starts with ~/ opens.')
}

/** The file the path leads to, links followed, and what it is. */
async function resolve(path: string, home: string): Promise<{ real: string; size: number; mode: number }> {
  const wanted = expand(path, home)
  let real: string
  try {
    real = await realpath(wanted)
  } catch {
    throw new Unavailable(`There is no file at ${path}.`)
  }
  const info = await stat(real)
  if (!info.isFile()) throw new Unavailable(`${path} is not a regular file (a folder or a device cannot be shown).`)
  return { real, size: info.size, mode: info.mode }
}

const megabytes = (bytes: number) => `${Number((bytes / (1024 * 1024)).toFixed(1))} MB`

/**
 * A file for the viewer: an image (known by its bytes) as a data URL, or the text of a small text file. Refuses,
 * with a plain reason, anything else.
 */
export async function readForViewer(path: string, { home = homedir(), maxBytes = MAX_FILE_BYTES, maxImageBytes = MAX_IMAGE_BYTES }: FileOptions = {}): Promise<FileContent> {
  const { real } = await resolve(path, home)
  // O_NONBLOCK keeps a pipe swapped in after the check from hanging the host; the second look settles it is still a file.
  const handle = await open(real, constants.O_RDONLY | constants.O_NONBLOCK)
  let type: ImageType | null
  let bytes: Buffer
  try {
    const info = await handle.stat()
    if (!info.isFile()) throw new Unavailable(`${path} is not a regular file (a folder or a device cannot be shown).`)
    type = imageTypeOf(await readUpTo(handle, SNIFF_BYTES))
    const what = type ? 'image' : 'file'
    const limit = type ? maxImageBytes : maxBytes
    if (info.size > limit) throw new Unavailable(`The ${what} is too large to show (${info.size.toLocaleString('en-US')} bytes; the limit is ${megabytes(limit)}).`)
    bytes = await readUpTo(handle, limit + 1)
    if (bytes.length > limit) throw new Unavailable(`The ${what} is too large to show (more than ${megabytes(limit)}).`)
  } finally {
    await handle.close()
  }

  const shown = { path: real, name: basename(real), bytes: bytes.length }
  if (type) return { kind: 'image', ...shown, type, url: `data:${type};base64,${bytes.toString('base64')}` }
  if (bytes.subarray(0, SNIFF_BYTES).includes(0)) throw new Unavailable('This is not a text file (it looks binary), so it cannot be shown.')
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Unavailable('This is not a text file (it is not UTF-8), so it cannot be shown.')
  }
  return { kind: 'text', ...shown, text, markdown: MARKDOWN.has(extname(real).toLowerCase()) }
}

/** The first `length` bytes of an open file, or all of it when it is shorter. */
async function readUpTo(handle: FileHandle, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length)
  const { bytesRead } = await handle.read(buffer, 0, length, 0)
  return buffer.subarray(0, bytesRead)
}

/**
 * The real path of a file that may open in the Mac's default app. Any regular file may, large or binary, because
 * the app reads it; a program, an app bundle or anything marked executable never does.
 */
export async function openablePath(path: string, { home = homedir() }: FileOptions = {}): Promise<string> {
  const { real, mode } = await resolve(path, home)
  if (PROGRAMS.has(extname(real).toLowerCase()) || mode & 0o111) throw new Unavailable('A program does not open from a link. Open it from the Finder.')
  return real
}
