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
import type { CodeHost } from './code-hosts.ts'
import { ghText, type GhCall } from './gh.ts'
import { githubRepoOf } from './publish.ts'

export type PullTarget = Extract<ReviewTarget, { kind: 'pull' }>

/** Says one step of the work in plain words, for the review's log. */
export type Say = (text: string) => void

export interface PullCheckout {
  /**
   * Fetches the pull request at `head`, and the branch it merges into, into hobkin's own refs. Answers the repository's
   * folder and the commit the change starts from: where `head` and that branch, as just fetched, last met.
   */
  fetch(target: PullTarget, pull: { head: string; baseBranch: string; headBranch?: string }, say?: Say): Promise<{ repo: string; base: string }>
  /** The repository's folder with `head` in it, found or made, fetching the pull request's head again when it is not there. */
  repoFor(target: PullTarget, head: string, say?: Say): Promise<string>
  /**
   * Deletes a branch on a named code host with git, from the clone its pull request is fetched into, only while it is at
   * `sha`, and answers once the host says it is gone. Refused for a commit that is not one, or a name git takes as no branch.
   */
  deleteBranch(target: PullTarget, branch: string, sha: string): Promise<void>
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

/** The refs a pull request is fetched into, apart for each named code host. Only hobkin writes or reads them. */
export function pullRefs(target: PullTarget): { head: string; base: string } {
  const at = `refs/hobkin/review/${target.host ? `${target.host}/` : ''}pull/${target.number}`
  return { head: `${at}/head`, base: `${at}/base` }
}

/** Where hobkin keeps its own clone of a repository: beside its review trees, in its client folder, apart for each named code host. */
export const ownCloneOf = (root: string, target: PullTarget) => join(root, 'client', 'review-clones', ...(target.host ? [target.host] : []), target.owner, target.repo)

/** A host's word with the pull request's repository and its number or branch filled in. */
const filled = (word: string, target: PullTarget, branch = '') =>
  word.replaceAll('{owner}', target.owner).replaceAll('{repo}', target.repo).replaceAll('{number}', String(target.number)).replaceAll('{branch}', branch)

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
  hostOf = () => undefined,
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
  /** A code host the home names, by its short name, as the code host file has it now. */
  hostOf?: (name: string) => CodeHost | undefined
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

  /** Whether a folder is a repository git can read: a bare clone counts. */
  const isRepository = (folder: string) => git(folder, 'rev-parse', '--git-dir').then(() => true, () => false)

  /**
   * A named host's repository on this Mac: the user's own clone the code host file lists, else hobkin's own, made with
   * git from the host's git address. Its fetches name that address, so no remote of the user's is used or changed.
   */
  async function hostPlace(target: PullTarget, host: CodeHost, say?: Say): Promise<Clone> {
    const key = `${target.owner}/${target.repo}`
    const address = filled(host.git, target)
    const listed = host.clones[key]
    if (listed && (await isRepository(listed))) {
      say?.(`Using the clone of ${key} at ${shown(listed)}. Only hobkin's own refs change in it.`)
      return { folder: listed, remote: address, own: false }
    }
    const folder = ownCloneOf(root, target)
    if (await isRepository(folder)) return { folder, remote: address, own: true }
    say?.(`There is no clone of ${key} from ${host.name} on this Mac, so hobkin makes its own. Its files come from ${host.name} as they are read.`)
    const making = `${folder}.cloning-${process.pid}`
    rmSync(making, { recursive: true, force: true })
    mkdirSync(dirname(folder), { recursive: true, mode: 0o700 })
    try {
      await git(dirname(folder), 'clone', '--quiet', '--filter=blob:none', '--no-checkout', '--', address, making)
      renameSync(making, folder)
    } catch (error) {
      rmSync(making, { recursive: true, force: true })
      throw new Error(`${key} could not be cloned from ${host.name}: ${messageOf(error)}`)
    }
    return { folder, remote: address, own: true }
  }

  /** The code host a named pull request lives on, as the code host file names it now. */
  const hostFor = (target: PullTarget) => {
    if (!target.host) return undefined
    const host = hostOf(target.host)
    if (!host) throw new Error(`${target.host} is not a code host the code host file names, so its pull request is not read.`)
    return host
  }
  /** Where a pull request is read from, in words. */
  const from = (target: PullTarget) => target.host ?? 'GitHub'
  /** The branch each pull request's head was last fetched by, for a host that keeps a pull request's head by branch. */
  const branches = new Map<string, string>()

  /** The repository's folder on this Mac, as found before, else looked for, else cloned. */
  async function place(target: PullTarget, say?: Say): Promise<Clone> {
    const host = hostFor(target)
    if (host) return hostPlace(target, host, say)
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
  const fetchInto = async (target: PullTarget, clone: Clone, refspecs: string[]) => {
    try {
      await git(clone.folder, 'fetch', '--quiet', '--no-tags', '--no-write-fetch-head', '--refmap=', clone.remote, ...refspecs)
    } catch (error) {
      throw new Error(`${from(target)} could not be fetched from: ${messageOf(error)}`)
    }
  }

  const moved = (target: PullTarget, head: string) =>
    new Error(`#${target.number} is no longer at ${head.slice(0, 7)} on ${from(target)}: it moved while it was fetched. Start its review again.`)

  /** The ref on its host that holds a pull request's head: GitHub's own, or the one its code host names. */
  const headRefOf = (target: PullTarget) => {
    const host = hostFor(target)
    return host ? filled(host.headRef, target, branches.get(reviewKey(target)) ?? '') : `refs/pull/${target.number}/head`
  }
  const reviewKey = (target: PullTarget) => `${target.host ?? ''}:${target.owner}/${target.repo}#${target.number}`

  return {
    async fetch(target, { head, baseBranch, headBranch }, say) {
      if (headBranch) branches.set(reviewKey(target), headBranch)
      const clone = await place(target, say)
      const refs = pullRefs(target)
      say?.(`Fetching #${target.number} and ${baseBranch} from ${from(target)}.`)
      await fetchInto(target, clone, [`+${headRefOf(target)}:${refs.head}`, `+refs/heads/${baseBranch}:${refs.base}`])
      if ((await git(clone.folder, 'rev-parse', refs.head)) !== head) throw moved(target, head)
      // The branch it merges into can have moved from the tip its host last said, as after a force push to the layer
      // under it: the change starts where its head meets that branch as fetched.
      const base = await git(clone.folder, 'merge-base', refs.base, head)
      if (clone.own) {
        // One diff reads every changed file at both ends, so a blobless clone fetches them in one go, not one by one.
        say?.('Fetching the changed files.')
        await git(clone.folder, 'diff', '--numstat', base, head)
      }
      return { repo: clone.folder, base }
    },
    async deleteBranch(target, branch, sha) {
      const host = hostFor(target)
      if (!host) throw new Error('A branch on GitHub is deleted through GitHub, not with git from here.')
      if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`${sha} is not a full commit, so ${branch} is not deleted.`)
      const clone = await place(target)
      const valid = await git(clone.folder, 'check-ref-format', '--branch', branch).then(() => !branch.startsWith('-'), () => false)
      if (!valid) throw new Error(`${branch} is not a branch name git takes, so nothing is deleted.`)
      const ref = `refs/heads/${branch}`
      try {
        // With a lease on the commit shown: a branch that moved since keeps it.
        await git(clone.folder, 'push', '--quiet', '--no-verify', `--force-with-lease=${ref}:${sha}`, clone.remote, `:${ref}`)
      } catch (error) {
        throw new Error(`${branch} was not deleted on ${host.name}: ${messageOf(error)}`)
      }
      // Only no such ref is gone: a listing that fails says nothing either way.
      let left: string
      try {
        left = await git(clone.folder, 'ls-remote', '--heads', clone.remote, ref)
      } catch (error) {
        throw new Error(`${host.name} could not say whether ${branch} is gone: ${messageOf(error)}`)
      }
      if (left.trim()) throw new Error(`${branch} is still on ${host.name}.`)
    },
    async repoFor(target, head, say) {
      const clone = await place(target, say)
      if (await has(clone.folder, head)) return clone.folder
      say?.(`Fetching #${target.number} from ${from(target)}.`)
      await fetchInto(target, clone, [`+${headRefOf(target)}:${pullRefs(target).head}`])
      if (!(await has(clone.folder, head))) throw moved(target, head)
      return clone.folder
    },
  }
}
