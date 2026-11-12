/**
 * A pull request's code on this Mac, for its change review (spec 032). The user's own clone of its repository is used
 * when there is one: a folder hobkin knows a project in, or a folder beside those, with a remote on GitHub that names
 * the repository. Without one, hobkin makes its own: a blobless clone through gh in its client folder, so a private
 * repository works and a file is fetched only once something reads it.
 *
 * The pull request's head and the branch it merges into are fetched into refs only hobkin uses
 * (`refs/hobkin/review/pull/<n>/head` and `…/base`). Nothing else moves: no branch, no remote-tracking ref, no
 * FETCH_HEAD, no index and no working tree of the user's. The review worktree is made from those commits afterwards.
 */
import { mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { ReviewTarget } from '#shared/review/ids.ts'
import { gitWithin, type GitRun } from './assessment.ts'
import { ghText, type GhCall } from './gh.ts'
import { githubRepoOf } from './publish.ts'

export type PullTarget = Extract<ReviewTarget, { kind: 'pull' }>

/** Says one step of the work in plain words, for the review's log. */
export type Say = (text: string) => void

export interface PullCheckout {
  /**
   * Fetches the pull request at `head`, and the branch it merges into, into hobkin's own refs. Answers the repository's
   * folder and the commit the change starts from: where `head` and that branch last met, as GitHub compares them.
   */
  fetch(target: PullTarget, pull: { head: string; baseBranch: string }, say?: Say): Promise<{ repo: string; base: string }>
  /** The repository's folder with `head` in it, found or made, fetching the pull request's head again when it is not there. */
  repoFor(target: PullTarget, head: string, say?: Say): Promise<string>
}

/** A fetch or a first checkout reads from GitHub, so it gets longer than local git. */
const FETCH_TIMEOUT_MS = 10 * 60_000
const CLONE_TIMEOUT_MS = 20 * 60_000

/** A repository on this Mac, and the remote in it that is the pull request's repository on GitHub. */
interface Clone {
  folder: string
  remote: string
  /** hobkin made it, in its own folder: its files come from GitHub as they are read. */
  own: boolean
}

/** The refs a pull request is fetched into. Only hobkin writes or reads them. */
export function pullRefs(target: PullTarget): { head: string; base: string } {
  const at = `refs/hobkin/review/pull/${target.number}`
  return { head: `${at}/head`, base: `${at}/base` }
}

/** Where hobkin keeps its own clone of a repository: beside its review trees, in its client folder. */
export const ownCloneOf = (root: string, target: PullTarget) => join(root, 'client', 'review-clones', target.owner, target.repo)

/** A folder in words, with the home folder as `~`. */
const shown = (folder: string) => (folder.startsWith(`${homedir()}/`) ? `~${folder.slice(homedir().length)}` : folder)

/** A repository's own folder: its `.git` is a folder. A linked worktree, whose `.git` is a file, is one of its trees. */
const isClone = (folder: string) => Boolean(statSync(join(folder, '.git'), { throwIfNoEntry: false })?.isDirectory())

/** The folders inside a folder, by name, but hidden ones. */
function foldersIn(parent: string): string[] {
  try {
    return readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => join(parent, entry.name))
      .sort()
  } catch {
    return []
  }
}

const messageOf = (error: unknown) => {
  const said = (error as { stderr?: string }).stderr?.trim().split('\n').find((line) => line.trim())
  return said || (error instanceof Error ? error.message : String(error))
}

export function pullCheckout({
  root,
  folders,
  gh,
  git = gitWithin(FETCH_TIMEOUT_MS),
  credentialHelper = null,
}: {
  /** The home: hobkin's own clones go in its client folder. */
  root: string
  /** The folders hobkin knows projects in. The folders beside them are looked in too. */
  folders: () => readonly string[]
  /** gh, to clone a repository the user has no clone of, with the login gh already has. */
  gh: GhCall
  git?: GitRun
  /** How git in hobkin's own clone signs in to GitHub later, such as `!gh auth git-credential`. Null leaves git's own. */
  credentialHelper?: string | null
}): PullCheckout {
  /** The answer for each repository, `owner/repo`, so the folders are looked through once. */
  const found = new Map<string, Clone>()

  /** The remotes a repository has, by name, with their addresses as written. */
  const remotesOf = async (folder: string): Promise<{ name: string; url: string }[]> => {
    try {
      const listed = await git(folder, 'config', '--get-regexp', '^remote\\..*\\.url$')
      return listed.split('\n').flatMap((line) => {
        const [, name, url] = /^remote\.(.+)\.url (.+)$/.exec(line.trim()) ?? []
        return name && url ? [{ name, url }] : []
      })
    } catch {
      // No remote at all, or not a repository git can read.
      return []
    }
  }

  /** The user's own clone of the repository, or null: hobkin's project folders first, then the folders beside them. */
  async function userClone(key: string): Promise<Clone | null> {
    const known = folders().map((folder) => resolve(folder))
    const beside = [...new Set(known.map((folder) => dirname(folder)))].flatMap(foldersIn)
    for (const folder of new Set([...known, ...beside])) {
      if (!isClone(folder)) continue
      const remote = (await remotesOf(folder)).find(({ url }) => githubRepoOf(url)?.toLowerCase() === key)
      if (remote) return { folder, remote: remote.name, own: false }
    }
    return null
  }

  /** hobkin's own clone: blobless, with no checkout, made whole beside where it goes and then moved in, so a failed clone leaves nothing. */
  async function ownClone(target: PullTarget, key: string, say?: Say): Promise<Clone> {
    const folder = ownCloneOf(root, target)
    if (isClone(folder)) return { folder, remote: 'origin', own: true }
    say?.(`There is no clone of ${key} on this Mac, so hobkin makes its own. Its files come from GitHub as they are read.`)
    const making = `${folder}.cloning-${process.pid}`
    rmSync(making, { recursive: true, force: true })
    mkdirSync(dirname(folder), { recursive: true, mode: 0o700 })
    try {
      await ghText(gh, ['repo', 'clone', key, making, '--', '--filter=blob:none', '--no-checkout'], undefined, { timeoutMs: CLONE_TIMEOUT_MS })
      if (credentialHelper) {
        // An empty helper first, so only this one answers for GitHub in this clone. The user's own settings stay as they are.
        await git(making, 'config', '--local', '--replace-all', 'credential.https://github.com.helper', '')
        await git(making, 'config', '--local', '--add', 'credential.https://github.com.helper', credentialHelper)
      }
      renameSync(making, folder)
    } catch (error) {
      rmSync(making, { recursive: true, force: true })
      throw new Error(`${key} could not be cloned: ${messageOf(error)}`)
    }
    return { folder, remote: 'origin', own: true }
  }

  /** The repository's folder on this Mac, as found before, else looked for, else cloned. */
  async function place(target: PullTarget, say?: Say): Promise<Clone> {
    const key = `${target.owner}/${target.repo}`
    const known = found.get(key)
    if (known && isClone(known.folder)) return known
    const clone = (await userClone(key)) ?? (await ownClone(target, key, say))
    if (!clone.own) say?.(`Using the clone of ${key} at ${shown(clone.folder)}. Only hobkin's own refs change in it.`)
    found.set(key, clone)
    return clone
  }

  /** Whether the commit is in the repository. */
  const has = (folder: string, commit: string) => git(folder, 'rev-parse', '--verify', '--quiet', `${commit}^{commit}`).then(() => true, () => false)

  /**
   * Fetches into hobkin's refs only: no tags, no FETCH_HEAD, and no remote-tracking ref, which git would otherwise move
   * for a branch its remote's settings name.
   */
  const fetchInto = async (clone: Clone, refspecs: string[]) => {
    try {
      await git(clone.folder, 'fetch', '--quiet', '--no-tags', '--no-write-fetch-head', '--refmap=', clone.remote, ...refspecs)
    } catch (error) {
      throw new Error(`GitHub could not be fetched from: ${messageOf(error)}`)
    }
  }

  const moved = (target: PullTarget, head: string) =>
    new Error(`#${target.number} is no longer at ${head.slice(0, 7)} on GitHub: it moved while it was fetched. Start its review again.`)

  return {
    async fetch(target, { head, baseBranch }, say) {
      const clone = await place(target, say)
      const refs = pullRefs(target)
      say?.(`Fetching #${target.number} and ${baseBranch} from GitHub.`)
      await fetchInto(clone, [`+refs/pull/${target.number}/head:${refs.head}`, `+refs/heads/${baseBranch}:${refs.base}`])
      if (!(await has(clone.folder, head))) throw moved(target, head)
      const base = await git(clone.folder, 'merge-base', refs.base, head)
      if (clone.own) {
        // One diff reads every changed file at both ends, so a blobless clone fetches them in one go, not one by one.
        say?.('Fetching the changed files.')
        await git(clone.folder, 'diff', '--numstat', base, head)
      }
      return { repo: clone.folder, base }
    },
    async repoFor(target, head, say) {
      const clone = await place(target, say)
      if (await has(clone.folder, head)) return clone.folder
      say?.(`Fetching #${target.number} from GitHub.`)
      await fetchInto(clone, [`+refs/pull/${target.number}/head:${pullRefs(target).head}`])
      if (!(await has(clone.folder, head))) throw moved(target, head)
      return clone.folder
    },
  }
}
