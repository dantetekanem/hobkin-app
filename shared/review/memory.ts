import type { ChangeReader, ChangedPath, FileRead } from './capture.ts'

/** A repository side held in memory: path to text. A `Uint8Array` stands for a binary file. */
export type Tree = Record<string, string | Uint8Array>

/**
 * A change read from two in-memory trees instead of git. Tests and generated sample data use it.
 * `renames` maps a path at base to its path at head. The commits are named `base` and `head`.
 */
export function memoryReader(base: Tree, head: Tree, renames: Record<string, string> = {}): ChangeReader {
  const trees: Record<string, Tree> = { base, head }
  const renamedFrom = new Set(Object.keys(renames))
  const renamedTo = new Set(Object.values(renames))
  return {
    async changed() {
      const changed: ChangedPath[] = Object.entries(renames).map(([oldPath, path]) => ({ path, oldPath, status: 'renamed' }))
      for (const path of new Set([...Object.keys(base), ...Object.keys(head)])) {
        if (renamedFrom.has(path) || renamedTo.has(path)) continue
        if (!(path in base)) changed.push({ path, status: 'added' })
        else if (!(path in head)) changed.push({ path, status: 'deleted' })
        else if (base[path] !== head[path]) changed.push({ path, status: 'modified' })
      }
      return changed
    },
    async read(commit, path): Promise<FileRead> {
      const value = trees[commit]?.[path]
      if (value == null) return { kind: 'missing' }
      return typeof value === 'string' ? { kind: 'text', text: value } : { kind: 'binary' }
    },
  }
}

export const lines = (...values: string[]) => `${values.join('\n')}\n`
