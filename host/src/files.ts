import { constants } from 'node:fs'
import { open, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, extname, isAbsolute, join } from 'node:path'
import type { FileContent } from '#shared/protocol/files.ts'
import { Unavailable } from './commands.ts'

/**
 * Reading a file the user clicked, for the viewer (_specs/027-links-and-files). Text only, small, and only a
 * regular file: a folder, a device, a pipe or a link to one is refused. A symlink is followed and the answer names
 * the file it led to.
 */

/** The most a file may weigh to be shown. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024

/** How far into a file a zero byte settles that it is not text. */
const SNIFF_BYTES = 8000

const MARKDOWN = new Set(['.md', '.markdown', '.mdx'])

/** Programs and bundles: opening one in its default app would run it, so they never open from a link. */
const PROGRAMS = new Set(['.app', '.command', '.tool', '.terminal', '.workflow', '.action', '.scpt', '.scptd', '.pkg', '.mpkg', '.dmg', '.jar', '.webloc', '.url', '.inetloc', '.fileloc', '.shortcut', '.service', '.prefpane', '.saver', '.kext', '.sh', '.bash', '.zsh', '.csh', '.pl', '.py', '.rb'])

export interface FileOptions {
  /** What `~/` stands for. */
  home?: string
  maxBytes?: number
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

/** The text of a file, for the viewer. Refuses, with a plain reason, anything that is not a small text file. */
export async function readTextFile(path: string, { home = homedir(), maxBytes = MAX_FILE_BYTES }: FileOptions = {}): Promise<FileContent> {
  const { real, size } = await resolve(path, home)
  if (size > maxBytes) throw new Unavailable(`The file is too large to show (${size.toLocaleString('en-US')} bytes; the limit is ${megabytes(maxBytes)}).`)

  // O_NONBLOCK keeps a pipe swapped in after the check from hanging the host; the second look settles it is still a file.
  const handle = await open(real, constants.O_RDONLY | constants.O_NONBLOCK)
  let bytes: Buffer
  try {
    if (!(await handle.stat()).isFile()) throw new Unavailable(`${path} is not a regular file (a folder or a device cannot be shown).`)
    const buffer = Buffer.alloc(maxBytes + 1)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    bytes = buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
  if (bytes.length > maxBytes) throw new Unavailable(`The file is too large to show (more than ${megabytes(maxBytes)}).`)

  if (bytes.subarray(0, SNIFF_BYTES).includes(0)) throw new Unavailable('This is not a text file (it looks binary), so it cannot be shown.')
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Unavailable('This is not a text file (it is not UTF-8), so it cannot be shown.')
  }
  return { path: real, name: basename(real), text, bytes: bytes.length, markdown: MARKDOWN.has(extname(real).toLowerCase()) }
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
