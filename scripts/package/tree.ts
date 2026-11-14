/** Reading a staged tree: its files, its size, and the links that would make it depend on the Mac it was built on. */
import { lstatSync, readdirSync, readlinkSync, type Stats } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

/** Every entry under a folder, depth first. Links are listed, never followed. */
export function* entriesUnder(root: string): Generator<{ path: string; stat: Stats }> {
  for (const name of readdirSync(root)) {
    const path = join(root, name)
    const stat = lstatSync(path)
    yield { path, stat }
    if (stat.isDirectory()) yield* entriesUnder(path)
  }
}

/** Bytes in the files under a folder, as a disk image would hold them before compression. */
export function bytesUnder(root: string): number {
  let total = 0
  for (const { stat } of entriesUnder(root)) if (stat.isFile()) total += stat.size
  return total
}

export const isInside = (root: string, path: string): boolean => {
  const from = relative(resolve(root), resolve(path))
  return from === '' || (!from.startsWith(`..${sep}`) && from !== '..' && !from.startsWith(sep))
}

/** The links under a folder that point outside it, each with where it points. A copied app would carry them broken. */
export function linksLeaving(root: string): string[] {
  const leaving: string[] = []
  for (const { path, stat } of entriesUnder(root)) {
    if (!stat.isSymbolicLink()) continue
    const target = resolve(dirname(path), readlinkSync(path))
    if (!isInside(root, target)) leaving.push(`${relative(root, path)} -> ${readlinkSync(path)}`)
  }
  return leaving
}

/** Every link under a folder, wherever it points. */
export function linksUnder(root: string): string[] {
  return [...entriesUnder(root)].filter(({ stat }) => stat.isSymbolicLink()).map(({ path }) => relative(root, path))
}

/** A byte count people can read. */
export const megabytes = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`
