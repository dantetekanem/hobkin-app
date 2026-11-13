import { readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Whether the code this host is running is older than the code on disk. A host loads its code once, when it starts,
 * so every change made to it afterwards waits for the next start. The window reloads its own code as it changes, which
 * makes a host left running look as if a fix had not worked: the window shows the new screens over the old rules. This
 * says so, with how many files changed, so the window can offer to restart the host and nothing else.
 */
export interface HostCode {
  /** When this host started, as an ISO time. */
  startedAt: string
  /** Files of the host's own code changed on disk since then. */
  changed: number
  /** When the newest of them changed, as an ISO time. Null when none did. */
  newestAt: string | null
}

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const CODE = /\.(ts|mjs|js|md|json)$/
const SKIPPED = new Set(['node_modules', 'test', 'tests', 'examples', 'dist', '.git'])

/** Where the code a host runs lives: its own, what it shares with the window, the change review, and hobkin itself. */
function roots(): string[] {
  const own = [join(REPO, 'host', 'src'), join(REPO, 'shared'), join(REPO, 'packages', 'change-review', 'src'), join(REPO, 'packages', 'change-review', 'prompts')]
  try {
    return [...own, dirname(dirname(fileURLToPath(import.meta.resolve('hobkin/src/cli/work/store.mjs'))))]
  } catch {
    return own
  }
}

function newerIn(folder: string, since: number, found: number[]): void {
  let names: string[]
  try {
    names = readdirSync(folder)
  } catch {
    return
  }
  for (const name of names) {
    if (SKIPPED.has(name)) continue
    const path = join(folder, name)
    const stat = statSync(path, { throwIfNoEntry: false })
    if (!stat) continue
    if (stat.isDirectory()) newerIn(path, since, found)
    else if (CODE.test(name) && stat.mtimeMs > since) found.push(stat.mtimeMs)
  }
}

/** How the code on disk stands against the code a host that started at `startedAt` is running. */
export function hostCode(startedAt: number, folders: readonly string[] = roots()): HostCode {
  const found: number[] = []
  for (const folder of folders) newerIn(folder, startedAt, found)
  return { startedAt: new Date(startedAt).toISOString(), changed: found.length, newestAt: found.length ? new Date(Math.max(...found)).toISOString() : null }
}
